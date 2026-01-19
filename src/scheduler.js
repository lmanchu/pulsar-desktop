/**
 * Pulsar Scheduler
 * Manages scheduled posts queue and execution
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

class Scheduler {
  constructor() {
    this.jobs = [];
    this.dataPath = path.join(app.getPath('userData'), 'scheduler-data.json');
    this.checkInterval = null;
    this.onExecuteJob = null; // Callback for job execution
  }

  // Initialize scheduler
  init(onExecuteJob) {
    this.onExecuteJob = onExecuteJob;
    this.loadJobs();
    this.startChecking();
    console.log('[Scheduler] Initialized with', this.jobs.length, 'jobs');
  }

  // Load jobs from disk
  loadJobs() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const data = fs.readFileSync(this.dataPath, 'utf8');
        this.jobs = JSON.parse(data);
        // Filter out completed/failed jobs older than 24 hours
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.jobs = this.jobs.filter(job =>
          job.status === 'pending' || job.updatedAt > cutoff
        );
      }
    } catch (error) {
      console.error('[Scheduler] Failed to load jobs:', error);
      this.jobs = [];
    }
  }

  // Save jobs to disk
  saveJobs() {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.jobs, null, 2));
    } catch (error) {
      console.error('[Scheduler] Failed to save jobs:', error);
    }
  }

  // Add a new scheduled job
  addJob(job) {
    const newJob = {
      id: `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      platform: job.platform || 'twitter',
      content: job.content,
      scheduledAt: job.scheduledAt || Date.now(), // Immediate if not specified
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: null
    };

    this.jobs.push(newJob);
    this.saveJobs();
    console.log('[Scheduler] Added job:', newJob.id, 'scheduled for:', new Date(newJob.scheduledAt).toLocaleString());

    return newJob;
  }

  // Get all jobs
  getJobs() {
    return this.jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Get pending jobs
  getPendingJobs() {
    return this.jobs.filter(job => job.status === 'pending');
  }

  // Update job status
  updateJob(jobId, updates) {
    const job = this.jobs.find(j => j.id === jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: Date.now() });
      this.saveJobs();
    }
    return job;
  }

  // Delete a job
  deleteJob(jobId) {
    this.jobs = this.jobs.filter(j => j.id !== jobId);
    this.saveJobs();
  }

  // Clear completed jobs
  clearCompleted() {
    this.jobs = this.jobs.filter(j => j.status === 'pending');
    this.saveJobs();
  }

  // Start checking for due jobs
  startChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Check every 30 seconds
    this.checkInterval = setInterval(() => {
      this.checkAndExecute();
    }, 30000);

    // Also check immediately
    this.checkAndExecute();
  }

  // Stop checking
  stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // Check for due jobs and execute
  async checkAndExecute() {
    const now = Date.now();
    const dueJobs = this.jobs.filter(job =>
      job.status === 'pending' && job.scheduledAt <= now
    );

    for (const job of dueJobs) {
      console.log('[Scheduler] Executing due job:', job.id);

      // Mark as processing
      this.updateJob(job.id, { status: 'processing' });

      try {
        if (this.onExecuteJob) {
          const result = await this.onExecuteJob(job);

          if (result.success) {
            this.updateJob(job.id, {
              status: 'completed',
              result: result
            });
            console.log('[Scheduler] Job completed:', job.id);
          } else {
            this.updateJob(job.id, {
              status: 'failed',
              result: result
            });
            console.log('[Scheduler] Job failed:', job.id, result.error);
          }
        }
      } catch (error) {
        this.updateJob(job.id, {
          status: 'failed',
          result: { success: false, error: error.message }
        });
        console.error('[Scheduler] Job execution error:', job.id, error);
      }
    }
  }

  // Get statistics
  getStats() {
    const stats = {
      total: this.jobs.length,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    for (const job of this.jobs) {
      if (stats[job.status] !== undefined) {
        stats[job.status]++;
      }
    }

    return stats;
  }
}

module.exports = new Scheduler();
