const { spawn } = require('child_process');
const path = require('path');

class FaceRecManager {
  constructor() {
    this.pythonDaemon = null;
    this.queue = [];
    this.stdoutBuffer = '';
    this.isInitializing = false;
    this.scriptPath = path.join(__dirname, 'face_rec.py');
  }

  ensureDaemon() {
    if (this.pythonDaemon) return Promise.resolve();
    if (this.isInitializing) {
      // If already initializing, wait and check periodically
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.pythonDaemon) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }

    this.isInitializing = true;
    return new Promise((resolve, reject) => {
      try {
        console.log('[FaceRecManager] Spawning Python face recognition daemon...');
        this.pythonDaemon = spawn('python3', [this.scriptPath, 'daemon']);

        this.pythonDaemon.stdout.on('data', (data) => {
          this.stdoutBuffer += data.toString();
          this.processBuffer();
        });

        this.pythonDaemon.stderr.on('data', (data) => {
          console.error(`[FaceRecDaemon Stderr] ${data.toString().trim()}`);
        });

        this.pythonDaemon.on('close', (code) => {
          console.warn(`[FaceRecManager] Daemon exited with code ${code}`);
          this.handleCrash(new Error(`Daemon exited with code ${code}`));
        });

        this.pythonDaemon.on('error', (err) => {
          console.error('[FaceRecManager] Daemon process error:', err);
          this.handleCrash(err);
        });

        // The daemon prints {"status": "ready"} on success.
        // Let's intercept the first message to resolve the startup.
        const startupCallback = (msg) => {
          this.isInitializing = false;
          if (msg.status === 'ready') {
            console.log('[FaceRecManager] Daemon is ready and running.');
            resolve();
          } else {
            reject(new Error(`Daemon startup failed: ${JSON.stringify(msg)}`));
          }
        };

        this.queue.push({ resolve: startupCallback, reject });

      } catch (err) {
        this.isInitializing = false;
        reject(err);
      }
    });
  }

  processBuffer() {
    let newlineIdx;
    while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.substring(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.substring(newlineIdx + 1);

      if (!line) continue;

      try {
        const payload = JSON.parse(line);
        const nextJob = this.queue.shift();
        if (nextJob) {
          if (payload.error) {
            nextJob.reject(new Error(payload.error));
          } else {
            nextJob.resolve(payload);
          }
        }
      } catch (err) {
        console.error('[FaceRecManager] Failed to parse JSON from stdout line:', line, err);
      }
    }
  }

  handleCrash(error) {
    this.pythonDaemon = null;
    this.isInitializing = false;
    this.stdoutBuffer = '';
    
    // Reject all pending jobs in the queue
    const currentQueue = this.queue;
    this.queue = [];
    currentQueue.forEach((job) => job.reject(error));
  }

  async sendCommand(command) {
    await this.ensureDaemon();
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      try {
        this.pythonDaemon.stdin.write(JSON.stringify(command) + '\n');
      } catch (err) {
        // Remove this job from the queue if stdin write failed
        const idx = this.queue.findIndex(job => job.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(err);
      }
    });
  }

  async validateSelfie(imagePath) {
    return this.sendCommand({ action: 'validate', image_path: imagePath });
  }

  async verifyAnchor(imagePath, anchorVector) {
    return this.sendCommand({ action: 'verify', image_path: imagePath, anchor_vector: anchorVector });
  }

  async matchSelfie(selfiePath, dbVectors, extraVectors = []) {
    return this.sendCommand({ action: 'match', selfie_path: selfiePath, db_vectors: dbVectors, extra_vectors: extraVectors });
  }

  async clusterFaces(dbVectors) {
    return this.sendCommand({ action: 'cluster', db_vectors: dbVectors });
  }

  shutdown() {
    if (this.pythonDaemon) {
      try {
        this.pythonDaemon.stdin.write(JSON.stringify({ action: 'exit' }) + '\n');
        this.pythonDaemon.kill();
      } catch (e) {}
      this.pythonDaemon = null;
    }
  }
}

// Singleton instance
const managerInstance = new FaceRecManager();

// Ensure clean termination on server exit
process.on('exit', () => managerInstance.shutdown());
process.on('SIGINT', () => {
  managerInstance.shutdown();
  process.exit();
});

module.exports = managerInstance;
