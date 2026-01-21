import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

export class UpscaleService {
    private static _instance: UpscaleService;
    private pythonProcess: ChildProcess | null = null;
    private readonly PORT = 50051;
    private readonly HOST = '127.0.0.1';
    private isStarting = false;

    private constructor() {
        // Private constructor for singleton
    }

    public static get instance(): UpscaleService {
        if (!UpscaleService._instance) {
            UpscaleService._instance = new UpscaleService();
        }
        return UpscaleService._instance;
    }

    /**
     * Ensure the Python service is running
     */
    public async ensureStarted(): Promise<boolean> {
        // 1. If currently starting, wait for it to finish
        if (this.isStarting) {
            // Simple wait loop if already starting
            for (let i = 0; i < 60; i++) { // Increased wait for slow GPU load
                await new Promise(r => setTimeout(r, 1000));
                if (this.pythonProcess && !this.pythonProcess.killed) {
                    // Verify it actually finished starting by pinging
                    if (await this.ping()) return true;
                }
            }
            return false;
        }

        // 2. If process exists, check health
        if (this.pythonProcess && !this.pythonProcess.killed) {
            // Check health
            const healthy = await this.ping();
            if (healthy) return true;

            console.log('[UpscaleService] Process exists but unhealthy, restarting...');
            this.kill();
        }

        this.isStarting = true;
        try {
            console.log('[UpscaleService] Starting Python backend...');
            const scriptPath = path.join(__dirname, '../../tools/upscale_service.py');
            const venvPython = path.join(__dirname, '../../scripts/venv/Scripts/python.exe');
            const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python';

            if (!fs.existsSync(scriptPath)) {
                console.error('[UpscaleService] Critical: Service script not found at', scriptPath);
                return false;
            }

            this.pythonProcess = spawn(pythonCmd, [scriptPath], {
                cwd: path.dirname(path.dirname(__dirname)), // Project root
                stdio: 'inherit' // Pipe output to main console
            });

            this.pythonProcess.on('error', (err) => {
                console.error('[UpscaleService] Failed to start process:', err);
            });

            this.pythonProcess.on('exit', (code) => {
                console.warn(`[UpscaleService] Python process exited with code ${code}`);
                this.pythonProcess = null;
            });

            // Wait for startup (ping loop)
            for (let i = 0; i < 30; i++) { // Wait up to 30s for model load
                await new Promise(r => setTimeout(r, 1000));
                if (await this.ping()) {
                    console.log('[UpscaleService] Backend ready!');
                    return true;
                }
            }

            console.error('[UpscaleService] Timed out waiting for backend to start');
            return false;

        } finally {
            this.isStarting = false;
        }
    }

    /**
     * Check if service is responsive
     */
    private async ping(): Promise<boolean> {
        return new Promise((resolve) => {
            const client = new net.Socket();
            client.setTimeout(1000);

            client.connect(this.PORT, this.HOST, () => {
                client.write('PING');
            });

            client.on('data', (data) => {
                if (data.toString() === 'PONG') resolve(true);
                else resolve(false);
                client.destroy();
            });

            client.on('error', () => {
                resolve(false);
                client.destroy();
            });

            client.on('timeout', () => {
                resolve(false);
                client.destroy();
            });
        });
    }

    public async upscale(inputPath: string, outputPath: string, scale: number = 1.5): Promise<boolean> {
        if (!await this.ensureStarted()) {
            return false;
        }

        return new Promise((resolve) => {
            const client = new net.Socket();
            client.setTimeout(600000); // 10 min timeout just in case

            client.connect(this.PORT, this.HOST, () => {
                const payload = `${inputPath}|${outputPath}|${scale}`;
                client.write(payload);
            });

            client.on('data', (data) => {
                const response = data.toString().trim();
                client.destroy();

                if (response === 'SUCCESS') {
                    resolve(true);
                } else {
                    console.error(`[UpscaleService] Error: ${response}`);
                    resolve(false);
                }
            });

            client.on('error', (err) => {
                console.error(`[UpscaleService] Socket error: ${err.message}`);
                client.destroy();
                resolve(false);
            });
        });
    }

    public kill() {
        if (this.pythonProcess) {
            console.log('[UpscaleService] Stopping backend...');
            this.pythonProcess.kill();
            this.pythonProcess = null;
        }
    }
}
