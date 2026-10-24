//
//  ThreadPool.hpp
//  react-native-quick-sqlite
//
//  Created by Oscar on 13.03.22.
//

#ifndef ThreadPool_hpp
#define ThreadPool_hpp

#include <condition_variable>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>

/**
 * A single worker thread running queued tasks in FIFO order. One exists per open
 * database, so work on a database finishes in the order it was submitted.
 */
class ThreadPool
{
public:
  ThreadPool();
  ~ThreadPool();
  void queueWork(std::function<void(void)> task);
  /** Stops the thread, joins it and drops queued tasks. Idempotent. */
  void stop();

private:
  void doWork();

  std::mutex workQueueMutex;
  std::condition_variable workQueueConditionVariable;
  // Guarded by workQueueMutex.
  std::queue<std::function<void(void)>> workQueue;
  bool done = false;
  std::thread thread;
};

#endif /* ThreadPool_hpp */
