import type { PayloadRequest } from 'payload'

type Task = () => Promise<void>

const QUEUE_KEY = 'afterCommitTasks'

/**
 * Хуки afterChange виконуються до коміту транзакції. Власник транзакції (ендпоінт)
 * відкриває чергу, і задачі з `runAfterCommit` чекають у ній до `flushAfterCommit`.
 */
export function openAfterCommitQueue(req: PayloadRequest): Task[] {
  const queue: Task[] = []
  req.context = { ...req.context, [QUEUE_KEY]: queue }
  return queue
}

/** Ставить задачу в чергу, якщо її відкрито; інакше виконує одразу. */
export async function runAfterCommit(req: PayloadRequest, task: Task): Promise<void> {
  const queue = req.context?.[QUEUE_KEY] as Task[] | undefined

  if (queue) {
    queue.push(task)
    return
  }

  await task()
}

/** Виконує відкладені задачі. Викликати лише після успішного коміту. */
export async function flushAfterCommit(req: PayloadRequest, queue: Task[]): Promise<void> {
  // Задачі, які з'являться під час виконання черги, виконуються одразу.
  if (req.context) delete req.context[QUEUE_KEY]

  for (const task of queue) {
    try {
      await task()
    } catch (error) {
      req.payload.logger.error({ err: error }, 'After-commit task failed')
    }
  }
}
