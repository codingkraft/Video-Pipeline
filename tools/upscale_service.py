import socket
import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import cv2
import sys
import os
import math
import time
import traceback

# ==============================================================================
# 0. Configuration
# ==============================================================================

PORT = 50051
HOST = '127.0.0.1'
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'weights', 'RealESRGAN_x4plus.pth')

# ==============================================================================
# 1. Model Definition (RRDBNet for RealESRGAN_x4plus)
# ==============================================================================

def make_layer(basic_block, num_basic_block, **kwarg):
    layers = []
    for _ in range(num_basic_block):
        layers.append(basic_block(**kwarg))
    return nn.Sequential(*layers)

class ResidualDenseBlock_5C(nn.Module):
    def __init__(self, nf=64, gc=32, bias=True):
        super(ResidualDenseBlock_5C, self).__init__()
        # gc: growth channel, nf: number of filters
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1, bias=bias)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1, bias=bias)
        self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1, bias=bias)
        self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1, bias=bias)
        self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1, bias=bias)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x

class RRDB(nn.Module):
    '''Residual in Residual Dense Block'''
    def __init__(self, nf, gc=32):
        super(RRDB, self).__init__()
        self.rdb1 = ResidualDenseBlock_5C(nf, gc)
        self.rdb2 = ResidualDenseBlock_5C(nf, gc)
        self.rdb3 = ResidualDenseBlock_5C(nf, gc)

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
        self.body = make_layer(RRDB, num_block, nf=num_feat, gc=num_grow_ch)
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        
        # upsampling
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1, bias=True)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat = feat + body_feat
        
        # Upsampling
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
        
        if self.device.type == 'cuda':
            torch.backends.cudnn.benchmark = True
        
        # Load RealESRGAN_x4plus (RRDBNet)
        self.model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
        
        try:
            # Check if weights exist (Wait loop if download is finishing)
            for _ in range(30):
                if os.path.exists(MODEL_PATH) and os.path.getsize(MODEL_PATH) > 1000000:
                    break
                print("[Service] Waiting for weights...")
                time.sleep(1)

            loadnet = torch.load(MODEL_PATH, map_location=self.device)
            keyname = 'params_ema' if 'params_ema' in loadnet else 'params'
            self.model.load_state_dict(loadnet[keyname], strict=True)
            self.model.eval()
            self.model.to(self.device)
            # FP16 enabled for speed/memory efficiency (RRDBNet is stable)
            if self.device.type == 'cuda':
                self.model.half()
            print(f"[Service] Model loaded successfully (RealESRGAN_x4plus) - FP16 Mode")
        except Exception as e:
            print(f"[Service] CRITICAL: Failed to load model: {e}")
            sys.exit(1)

    def tile_process(self, img, tile_size=1024, tile_pad=10):
        """
        Process image in tiles to save VRAM.
        img: (1, 3, H, W) tensor
        """
        batch, channel, height, width = img.shape
        output_height = height * self.model.scale
        output_width = width * self.model.scale
        output_shape = (batch, channel, output_height, output_width)

        # Start with cpu to save vram
        output = img.new_zeros(output_shape)
        tiles_x = math.ceil(width / tile_size)
        tiles_y = math.ceil(height / tile_size)
        total_tiles = tiles_x * tiles_y
        
        print(f"[Service] Tiling enabled: {tiles_x}x{tiles_y} ({total_tiles} tiles total)")

        # Loop over tiles
        tile_count = 0
        for y in range(tiles_y):
            for x in range(tiles_x):
                tile_count += 1
                
                # Calculate input tile coordinates
                ofs_x = x * tile_size
                ofs_y = y * tile_size
                
                # Input tile area on image
                input_start_x = ofs_x
                input_end_x = min(ofs_x + tile_size, width)
                input_start_y = ofs_y
                input_end_y = min(ofs_y + tile_size, height)
                
                # Input tile area with padding
                input_start_x_pad = max(input_start_x - tile_pad, 0)
                input_end_x_pad = min(input_end_x + tile_pad, width)
                input_start_y_pad = max(input_start_y - tile_pad, 0)
                input_end_y_pad = min(input_end_y + tile_pad, height)

                # Input tile dimensions
                input_tile_width = input_end_x - input_start_x
                input_tile_height = input_end_y - input_start_y
                
                input_tile = img[:, :, input_start_y_pad:input_end_y_pad, input_start_x_pad:input_end_x_pad]

                # Run inference on tile
                with torch.no_grad():
                    if hasattr(self.model, 'half') and img.dtype == torch.float16:
                         # Force empty cache if memory is tight
                        # torch.cuda.empty_cache() 
                        output_tile = self.model(input_tile)
                    else:
                        output_tile = self.model(input_tile)
                
                # Print progress every tile
                print(f"[Service] Processed Tile {tile_count}/{total_tiles}")

                # Output tile coordinates
                output_start_x = input_start_x * self.model.scale
                output_end_x = input_end_x * self.model.scale
                output_start_y = input_start_y * self.model.scale
                output_end_y = input_end_y * self.model.scale

                # Output tile coordinates with padding
                output_start_x_pad = input_start_x_pad * self.model.scale
                output_end_x_pad = input_end_x_pad * self.model.scale
                output_start_y_pad = input_start_y_pad * self.model.scale
                output_end_y_pad = input_end_y_pad * self.model.scale

                # Calculate offset in the output tile to crop
                tile_idx_x = (input_start_x - input_start_x_pad) * self.model.scale
                tile_idx_y = (input_start_y - input_start_y_pad) * self.model.scale
                tile_idx_w = input_tile_width * self.model.scale
                tile_idx_h = input_tile_height * self.model.scale

                output[:, :, output_start_y:output_end_y, output_start_x:output_end_x] = \
                    output_tile[:, :, tile_idx_y:tile_idx_y + tile_idx_h, tile_idx_x:tile_idx_x + tile_idx_w]

        return output

    def process(self, input_path, output_path, scale):
        try:
            img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
            if img is None:
                return f"ERROR: Could not read image {input_path}"

            h, w = img.shape[:2]

            # Alpha handling
            alpha = None
            if img.ndim == 3 and img.shape[2] == 4:
                alpha = img[:, :, 3]
                img = img[:, :, 0:3]
                alpha = cv2.resize(alpha, (img.shape[1]*4, img.shape[0]*4), interpolation=cv2.INTER_LINEAR)
                img = np.ascontiguousarray(img)

            # ==========================================================
            # PRE-PROCESSING
            # ==========================================================
            # Denoise disabled (Too slow on CPU, risking hang)
            # img = cv2.fastNlMeansDenoisingColored(img, None, h=3, hColor=3, templateWindowSize=7, searchWindowSize=21)
            
            print("[Service] Pre-processing done")

            # Preprocess for PyTorch
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t0 = time.time()
            
            img = img.astype(np.float32) / 255.
            img = torch.from_numpy(np.transpose(img[:, :, [2, 1, 0]], (2, 0, 1))).float()
            
            img = img.unsqueeze(0).to(self.device)
            if self.device.type == 'cuda':
                img = img.half()
            
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t1 = time.time()
            
            print(f"[Service] Starting Inference... ({img.shape})")

            # Inference (Tiled to prevent OOM/Hang)
            with torch.no_grad():
                # Tile size 400 fits comfortably in 4GB-6GB VRAM
                output = self.tile_process(img, tile_size=400, tile_pad=10)
            
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t2 = time.time()
            print("[Service] Inference done")

            # Postprocess (Optimized on GPU)
            # 1. Clamp and Convert to [0, 255] on GPU
            output = output.squeeze(0).clamp_(0, 1).mul_(255.0).round_()
            
            # 2. Resize on GPU to target scale
            c, out_h, out_w = output.shape
            
            # Model is X4
            in_w = out_w / 4
            target_w = int(in_w * scale)
            target_h = int(out_h * scale / 4)

            if out_w != target_w:
                output = output.unsqueeze(0)
                output = F.interpolate(output, size=(target_h, target_w), mode='bilinear', align_corners=False)
                output = output.squeeze(0)

            # 3. Convert to byte (uint8) ON GPU
            output = output.byte()

            # 4. Transfer to CPU and permute
            output = output.permute(1, 2, 0).cpu().numpy()

            if alpha is not None:
                if output.shape[:2] != alpha.shape[:2]:
                     alpha = cv2.resize(alpha, (output.shape[1], output.shape[0]), interpolation=cv2.INTER_LINEAR)
                output = np.dstack((output, alpha))
            
            # Convert RGB to BGR for OpenCV
            output = output[:, :, [2, 1, 0]]
            
            print("[Service] Starting Enhancement Stack...")

            # ==========================================================
            # POST-PROCESSING (Professional Polish)
            # ==========================================================
            
            # A. Adaptive Unsharp Mask (Edge-Aware Sharpening)
            gaussian = cv2.GaussianBlur(output, (0, 0), 1.0)
            output = cv2.addWeighted(output, 1.5, gaussian, -0.5, 0)

            # B. Gamma Correction (Improves contrast/readability)
            gamma = 0.95
            inv_gamma = 1.0 / gamma
            lut = np.array([((i / 255.0) ** inv_gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
            output = cv2.LUT(output, lut)

            # C. Bloom / Glow Effect (Optimized)
            # Calculate glow on smaller image (Much faster)
            small_h, small_w = output.shape[:2]
            small_h, small_w = small_h // 4, small_w // 4
            small = cv2.resize(output, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
            
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            # Threshold
            thresh = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY)[1]
            # Blur
            blur = cv2.GaussianBlur(thresh, (0, 0), 11) # Smaller kernel for smaller image
            blur_color = cv2.cvtColor(blur, cv2.COLOR_GRAY2BGR)
            
            # Resize bloom map back up
            bloom = cv2.resize(blur_color, (output.shape[1], output.shape[0]), interpolation=cv2.INTER_LINEAR)
            
            # Add bloom
            output = cv2.addWeighted(output, 1.0, bloom, 0.4, 0)

            # D. Subtle Vignette
            rows, cols = output.shape[:2]
            X = cv2.getGaussianKernel(cols, cols * 0.8)
            Y = cv2.getGaussianKernel(rows, rows * 0.8)
            mask = Y * X.T
            mask = mask / mask.max()
            vignette_strength = 0.15
            for i in range(3):
                output[:, :, i] = output[:, :, i] * (1 - vignette_strength + vignette_strength * mask)

            # E. Vibrance
            hsv = cv2.cvtColor(output.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
            hsv[:, :, 1] = hsv[:, :, 1] * 1.15 # Slightly richer
            hsv[:, :, 1] = np.clip(hsv[:, :, 1], 0, 255)
            output = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
            
            if self.device.type == 'cuda':
                torch.cuda.synchronize()
            t3 = time.time()
            
            print(f"[Service] {self.device} ({w}x{h}->{target_w}x{target_h}) Model: RRDBNet - Total: {(t3-t0):.3f}s")
            
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
    server.listen(1)
    print(f"[Service] Listening on {HOST}:{PORT}")

    while True:
        try:
            client, addr = server.accept()
            with client:
                data = client.recv(4096).decode('utf-8').strip()
                if not data: continue
                if data == "PING":
                    client.sendall(b"PONG")
                    continue
                parts = data.split('|')
                if len(parts) != 3:
                     client.sendall(b"ERROR: Invalid")
                     continue
                input_path, output_path, scale_str = parts
                result = upscaler.process(input_path, output_path, float(scale_str))
                client.sendall(result.encode('utf-8'))
        except Exception as e:
            print(f"[Service] Error: {e}")

if __name__ == '__main__':
    run_server()
