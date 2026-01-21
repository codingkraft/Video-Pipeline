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
import time

# ==============================================================================
# 0. Configuration
# ==============================================================================

PORT = 50051
HOST = '127.0.0.1'
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'weights', 'realesr-animevideov3.pth')

# ==============================================================================
# 1. Model Definition (SRVGGNetCompact)
# ==============================================================================

class SRVGGNetCompact(nn.Module):
    """A compact VGG-style network structure for super-resolution.
    It is a compact network structure, which performs upsampling in the last layer 
    and no convolution is conducted on the HR feature space.
    """
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=16, upscale=4, act_type='prelu'):
        super(SRVGGNetCompact, self).__init__()
        self.num_in_ch = num_in_ch
        self.num_out_ch = num_out_ch
        self.num_feat = num_feat
        self.num_conv = num_conv
        self.upscale = upscale
        self.act_type = act_type

        self.body = nn.ModuleList()
        # the first conv
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        # the first activation
        if act_type == 'relu':
            activation = nn.ReLU(inplace=True)
        elif act_type == 'prelu':
            activation = nn.PReLU(num_parameters=num_feat)
        elif act_type == 'leakyrelu':
            activation = nn.LeakyReLU(negative_slope=0.1, inplace=True)
        self.body.append(activation)

        # the body structure
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            # activation
            if act_type == 'relu':
                activation = nn.ReLU(inplace=True)
            elif act_type == 'prelu':
                activation = nn.PReLU(num_parameters=num_feat)
            elif act_type == 'leakyrelu':
                activation = nn.LeakyReLU(negative_slope=0.1, inplace=True)
            self.body.append(activation)

        # the last conv
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        # upsample
        self.pixel_shuffle = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for i in range(0, len(self.body)):
            out = self.body[i](out)

        out = self.pixel_shuffle(out)
        return out

# ==============================================================================
# 2. Inference Logic
# ==============================================================================

class Upscaler:
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"[Service] Initializing on {self.device}")
        
        if self.device.type == 'cuda':
            torch.backends.cudnn.benchmark = True
        
        # Load SRVGGNetCompact (x4 scale defined in weights, but typically mostly used for x2/x3/x4)
        # realesr-animevideov3 is an X4 model technically but very efficient
        # Wait, usually animevideov3 is X4. Let's check. 
        # Actually standard animevideov3 is X4. But it is vgg-style (fast).
        self.model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=16, upscale=4, act_type='prelu')
        
        try:
            loadnet = torch.load(MODEL_PATH, map_location=self.device)
            keyname = 'params_ema' if 'params_ema' in loadnet else 'params'
            self.model.load_state_dict(loadnet[keyname], strict=True)
            self.model.eval()
            self.model.to(self.device)
            # FP16 disabled due to artifacting/black output on some GPUs/Drivers
            # if self.device.type == 'cuda':
            #     self.model.half()
            print(f"[Service] Model loaded successfully (FP16: False)")
        except Exception as e:
            print(f"[Service] CRITICAL: Failed to load model: {e}")
            sys.exit(1)

    def process(self, input_path, output_path, scale):
        try:
            img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
            if img is None:
                return f"ERROR: Could not read image {input_path}"

            h, w = img.shape[:2]

            # Alpha handling
            if img.ndim == 3 and img.shape[2] == 4:
                alpha = img[:, :, 3]
                img = img[:, :, 0:3]
                alpha = cv2.resize(alpha, (img.shape[1]*4, img.shape[0]*4), interpolation=cv2.INTER_LINEAR)
                img = np.ascontiguousarray(img)
            else:
                alpha = None

            # Preprocess
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t0 = time.time()
            
            img = img.astype(np.float32) / 255.
            img = torch.from_numpy(np.transpose(img[:, :, [2, 1, 0]], (2, 0, 1))).float()
            
            img = img.unsqueeze(0).to(self.device)
            # if self.device.type == 'cuda':
            #     img = img.half()
            
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t1 = time.time()

            # Inference
            with torch.no_grad():
                output = self.model(img)
            
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t2 = time.time()

            # Postprocess (Optimized on GPU)
            # Fix: SRVGGNetCompact in RealESRGAN often predicts the RESIDUAL
            # We must add the upscaled base image!
            # 1. Upscale input to match output size (x4)
            base = F.interpolate(img, scale_factor=4, mode='bilinear', align_corners=False)
            
            # 2. Add residual to base
            output = output + base

            # 3. Clamp and Convert to [0, 255] on GPU
            output = output.squeeze(0).clamp_(0, 1).mul_(255.0).round_()
            
            # 4. Resize on GPU if needed (using bilinear interpolation)
            c, out_h, out_w = output.shape
            
            # Since model is X4, output is 4x input width
            in_w = out_w / 4
            target_w = int(in_w * scale)
            target_h = int(out_h * scale / 4)

            # Only resize if necessary (e.g. if we want 1.5x scale but model gave 4x)
            if out_w != target_w:
                output = output.unsqueeze(0)
                output = F.interpolate(output, size=(target_h, target_w), mode='bilinear', align_corners=False)
                output = output.squeeze(0)

            # 3. Convert to byte (uint8) ON GPU to minimize transfer bandwidth
            output = output.byte()

            # 4. Transfer to CPU and permute to [H, W, C] for OpenCV
            output = output.permute(1, 2, 0).cpu().numpy()

            if alpha is not None:
                if output.shape[:2] != alpha.shape[:2]:
                     alpha = cv2.resize(alpha, (output.shape[1], output.shape[0]), interpolation=cv2.INTER_LINEAR)
                output = np.dstack((output, alpha))
            
            output = output[:, :, [2, 1, 0]]
            
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t3 = time.time()
            
            print(f"[Service] {self.device} ({w}x{h}->{target_w}x{target_h}) FP16: False - Prep: {(t1-t0):.3f}s | Infer: {(t2-t1):.3f}s | Post: {(t3-t2):.3f}s | Total: {(t3-t0):.3f}s")
            
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
                
                if os.path.isdir(input_path):
                     pass

                result = upscaler.process(input_path, output_path, float(scale_str))
                client.sendall(result.encode('utf-8'))

        except Exception as e:
            if isinstance(e, ConnectionResetError):
                continue
            print(f"[Service] Connection error: {e}")

if __name__ == '__main__':
    run_server()
