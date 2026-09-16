import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearJobDonePartial,
  jobDone,
  resetJobStatus,
} from '../../src/renderer/src/signals/jobState'
import { queueRunning } from '../../src/renderer/src/signals/queueState'

describe('completed-job partial references', () => {
  beforeEach(() => {
    queueRunning.value = false
    resetJobStatus()
  })

  it('removes the Downloader reference only for the partial folder deleted from disk', () => {
    jobDone.value = {
      jobId: 'cancelled-job',
      status: 'cancelled',
      partialDir: 'C:/tmp/job-a',
    }

    clearJobDonePartial('C:/tmp/job-b')
    expect(jobDone.value?.partialDir).toBe('C:/tmp/job-a')

    clearJobDonePartial('C:/tmp/job-a')
    expect(jobDone.value?.partialDir).toBeUndefined()
  })
})
