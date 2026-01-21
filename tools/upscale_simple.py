import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import cv2
import sys
import os
import argparse

# ==============================================================================
# 1. Compact Model Definition (RRDBNet) to avoid dependencies
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
        # initialization
        # default_init_weights([self.conv1, self.conv2, self.conv3, self.conv4, self.conv5], 0.1)

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
        # upsample
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1, bias=True)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat = feat + body_feat
        # upsample
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        out = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out

# ==============================================================================
# 2. Main Logic
# ==============================================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-i', '--input', type=str, required=True, help='Input image path or directory')
    parser.add_argument('-o', '--output', type=str, required=False, help='Output image path or directory')
    parser.add_argument('-m', '--model_path', type=str, required=True, help='Model weights path')
    parser.add_argument('-s', '--scale', type=float, default=2.0, help='Output scale factor')
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input not found: {args.input}")
        sys.exit(1)

    # Initialize Model Once
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"[Python] Using device: {device}")

    model = RRDBNet(num_in_ch=3, num_out_ch=3, scale=4, num_feat=64, num_block=6, num_grow_ch=32)
    
    try:
        loadnet = torch.load(args.model_path, map_location=device)
        if 'params_ema' in loadnet:
            keyname = 'params_ema'
        else:
            keyname = 'params'
        model.load_state_dict(loadnet[keyname], strict=True)
    except Exception as e:
        print(f"[Python] Error loading model: {e}")
        sys.exit(1)

    model.eval()
    model = model.to(device)

    # Determine files to process
    files = []
    if os.path.isdir(args.input):
        # Batch Mode
        for f in os.listdir(args.input):
            if f.lower().endswith(('.png', '.jpg', '.jpeg')) and '_upscaled' not in f and '_clip_' in f:
                files.append(os.path.join(args.input, f))
    else:
        # Single File Mode
        files.append(args.input)

    print(f"[Python] Processing {len(files)} images...")

    for image_path in files:
        output_path = args.output
        if os.path.isdir(args.input) or (args.output and os.path.isdir(args.output)):
            # Auto-generate output path for batch
            dirname = args.output if (args.output and os.path.isdir(args.output)) else os.path.dirname(image_path)
            basename = os.path.basename(image_path)
            output_path = os.path.join(dirname, basename.replace('.png', '_upscaled.png').replace('.jpg', '_upscaled.png'))
        elif not output_path:
             output_path = image_path.replace('.png', '_upscaled.png')

        # Skip if already exists? Maybe not, force overwrite.
        print(f"[Python] Processing: {os.path.basename(image_path)}")
        process_image(image_path, output_path, model, device, args.scale)

def process_image(input_path, output_path, model, device, scale):
    try:
        # Read Image
        img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            print(f"Error reading image: {input_path}")
            return

        # Handle Alpha Channel (RGBA)
        if img.ndim == 3 and img.shape[2] == 4:
            img_mode = 'RGBA'
            alpha = img[:, :, 3]
            img = img[:, :, 0:3]
            alpha = cv2.resize(alpha, (img.shape[1]*4, img.shape[0]*4), interpolation=cv2.INTER_LINEAR)
            img = np.ascontiguousarray(img)
        else:
            img_mode = 'RGB'
            alpha = None

        # Preprocess
        img = img.astype(np.float32) / 255.
        img = torch.from_numpy(np.transpose(img[:, :, [2, 1, 0]], (2, 0, 1))).float()
        img = img.unsqueeze(0).to(device)

        # Inference
        with torch.no_grad():
            output = model(img)

        # Postprocess
        output = output.data.squeeze().float().cpu().clamp_(0, 1).numpy()
        output = np.transpose(output[[2, 1, 0], :, :], (1, 2, 0)) # CHW -> HWC, BGR
        output = (output * 255.0).round().astype(np.uint8)

        # Add alpha back
        if alpha is not None:
            output = np.dstack((output, alpha))

        # Output Resize (Target Scaling)
        # Original logic: Model outputs 4x. We want target scale relative to INPUT.
        # e.g. Input 720p. Model -> 2880p. Target 1080p (Scale 1.5).
        # We need to resize 2880p -> 1080p.
        
        # Calculate Input Dims based on original read
        # Note: 'img' tensor is already transformed. Use cv2 img struct from beginning?
        # We didn't keep original dimensions easily accessible, but output is 4x input.
        
        out_h, out_w = output.shape[:2]
        # Input was out_w / 4
        in_w = out_w / 4
        in_h = out_h / 4
        
        target_w = int(in_w * scale)
        target_h = int(in_h * scale)

        if out_w != target_w or out_h != target_h:
            output = cv2.resize(output, (target_w, target_h), interpolation=cv2.INTER_AREA)

        # Save
        cv2.imwrite(output_path, output)
        print(f"[Python] Saved: {os.path.basename(output_path)}")

    except Exception as e:
        print(f"[Python] Failed on {os.path.basename(input_path)}: {e}")

if __name__ == '__main__':
    main()
