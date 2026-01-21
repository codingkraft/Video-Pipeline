import socket
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import cv2
import sys
import os
import argparse
import traceback

# ==============================================================================
# 0. Configuration
# ==============================================================================

PORT = 50051
HOST = '127.0.0.1'
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'weights', 'RealESRGAN_x4plus_anime_6B.pth')

# ==============================================================================
# 1. Compact Model Definition (RRDBNet)
# ==============================================================================

def make_layer(basic_block, num_basic_block, **kwarg):
    layers = []
    for _ in range(num_basic_block):
        layers.append(basic_block(**kwarg))
    return nn.Sequential(*layers)

class ResidualDenseBlock_5C(nn.Module):
    def __init__(self, nc=64, gc=32, bias=True):
        super(ResidualDenseBlock_5C, self).__init__()
        self.conv1 = nn.Conv2d(nc, gc, 3, 1, 1, bias=bias)
        self.conv2 = nn.Conv2d(nc + gc, gc, 3, 1, 1, bias=bias)
        self.conv3 = nn.Conv2d(nc + 2 * gc, gc, 3, 1, 1, bias=bias)
        self.conv4 = nn.Conv2d(nc + 3 * gc, gc, 3, 1, 1, bias=bias)
        self.conv5 = nn.Conv2d(nc + 4 * gc, nc, 3, 1, 1, bias=bias)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x

class RRDB(nn.Module):
    def __init__(self, nc, gc=32):
        super(RRDB, self).__init__()
        self.rdb1 = ResidualDenseBlock_5C(nc, gc)
        self.rdb2 = ResidualDenseBlock_5C(nc, gc)
        self.rdb3 = ResidualDenseBlock_5C(nc, gc)

    def forward(self, x):
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x

class RRDBNet(nn.Module):
    def __init__(self, num_in_ch=3, num_out_ch=3, scale=4, num_feat=64, num_block=23, num_grow_ch=32):
        super(RRDBNet, self).__init__()
        self.scale = scale
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1, bias=True)
        self.body = make_layer(RRDB, num_block, nc=num_feat, gc=num_grow_ch)
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1, bias=True)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat = feat + body_feat
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        out = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out

# ==============================================================================
# 2. Inference Logic
# ==============================================================================

class Upscaler:
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"[Service] Initializing on {self.device}")
        
        self.model = RRDBNet(num_in_ch=3, num_out_ch=3, scale=4, num_feat=64, num_block=6, num_grow_ch=32)
        
        try:
            loadnet = torch.load(MODEL_PATH, map_location=self.device)
            keyname = 'params_ema' if 'params_ema' in loadnet else 'params'
            self.model.load_state_dict(loadnet[keyname], strict=True)
            self.model.eval()
            self.model.to(self.device)
            print("[Service] Model loaded successfully")
        except Exception as e:
            print(f"[Service] CRITICAL: Failed to load model: {e}")
            sys.exit(1)

    def process(self, input_path, output_path, scale):
        try:
            img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
            if img is None:
                return f"ERROR: Could not read image {input_path}"

            # Alpha handling
            if img.ndim == 3 and img.shape[2] == 4:
                alpha = img[:, :, 3]
                img = img[:, :, 0:3]
                alpha = cv2.resize(alpha, (img.shape[1]*4, img.shape[0]*4), interpolation=cv2.INTER_LINEAR)
                img = np.ascontiguousarray(img)
            else:
                alpha = None

            # Preprocess
            img = img.astype(np.float32) / 255.
            img = torch.from_numpy(np.transpose(img[:, :, [2, 1, 0]], (2, 0, 1))).float()
            img = img.unsqueeze(0).to(self.device)

            # Inference
            with torch.no_grad():
                output = self.model(img)

            # Postprocess
            output = output.data.squeeze().float().cpu().clamp_(0, 1).numpy()
            output = np.transpose(output[[2, 1, 0], :, :], (1, 2, 0))
            output = (output * 255.0).round().astype(np.uint8)

            if alpha is not None:
                output = np.dstack((output, alpha))

            # Resize to target scale
            out_h, out_w = output.shape[:2]
            in_w = out_w / 4
            target_w = int(in_w * scale)
            target_h = int(out_h * scale / 4) # Fix aspect ratio calc

            if out_w != target_w:
                output = cv2.resize(output, (target_w, target_h), interpolation=cv2.INTER_AREA)

            cv2.imwrite(output_path, output)
            return "SUCCESS"

        except Exception as e:
            traceback.print_exc()
            return f"ERROR: {str(e)}"

# ==============================================================================
# 3. Server Logic
# ==============================================================================

def run_server():
    upscaler = Upscaler()
    
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind((HOST, PORT))
    server.listen(1) # Start with 1 connection backlog
    
    print(f"[Service] Listening on {HOST}:{PORT}")

    while True:
        try:
            client, addr = server.accept()
            # print(f"[Service] Connection from {addr}")
            
            with client:
                data = client.recv(4096).decode('utf-8').strip()
                if not data:
                    continue

                if data == "PING":
                    client.sendall(b"PONG")
                    continue
                
                parts = data.split('|')
                if len(parts) != 3:
                    client.sendall(b"ERROR: Invalid format. Expected INPUT|OUTPUT|SCALE")
                    continue
                
                input_path, output_path, scale_str = parts
                
                # Check for batch vs single processing via path type
                if os.path.isdir(input_path):
                     # Add basic batch logic here too if needed, but TypeScript handles iteration usually
                     # Or we can support a special batch usage
                     pass

                result = upscaler.process(input_path, output_path, float(scale_str))
                client.sendall(result.encode('utf-8'))

        except Exception as e:
            print(f"[Service] Connection error: {e}")

if __name__ == '__main__':
    run_server()
