import torch
import sys

path = "tools/weights/RealESRGAN_x4plus.pth"
checkpoint = torch.load(path, map_location='cpu')

if 'params_ema' in checkpoint:
    keys = list(checkpoint['params_ema'].keys())
elif 'params' in checkpoint:
    keys = list(checkpoint['params'].keys())
else:
    keys = list(checkpoint.keys())

print(f"Total keys: {len(keys)}")
for k in keys[-20:]:
    print(k)
