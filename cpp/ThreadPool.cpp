//
//  ThreadPool.cpp
//  react-native-quick-sqlite
//
//  Created by Oscar on 13.03.22.
//

#include "ThreadPool.h"

ThreadPool::ThreadPool() : thread(&ThreadPool::doWork, this) {}

ThreadPool::~ThreadPool()
{
  stop();
}

void ThreadPool::stop()
{
  {
    std::lock_guard<std::mutex> g(workQueueMutex);
    if (done)
    {
      return;
    }
    done = true;
    std::queue<std::function<void(void)>>().swap(workQueue);
  }
  workQueueConditionVariable.notify_all();
  if (thread.joinable())
  {
    thread.join();
  }
}

void ThreadPool::queueWork(std::function<void(void)> task)
{
  {
    std::lock_guard<std::mutex> g(workQueueMutex);
    if (done)
    {
      return;
    }
    workQueue.push(std::move(task));
  }
  workQueueConditionVariable.notify_one();
}

void ThreadPool::doWork()
{
  while (true)
  {
    std::function<void(void)> task;
    {
      std::unique_lock<std::mutex> g(workQueueMutex);
      workQueueConditionVariable.wait(g, [&] { return !workQueue.empty() || done; });
      if (done)
      {
        return;
      }
      task = std::move(workQueue.front());
      workQueue.pop();
    }

    // An escaped exception would call std::terminate() on the worker thread.
    try
    {
      task();
    }
    catch (...)
    {
    }
  }
}
