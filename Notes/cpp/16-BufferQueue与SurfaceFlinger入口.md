# BufferQueue 与 SurfaceFlinger 入口

BufferQueue 是 Android 图形栈连接生产者和消费者的核心队列。理解它能把 Java View/Surface、Native Window、图层合成和显示输出串成一条路径。

## 生产者与消费者

生产者申请 buffer、写入内容、设置 fence 并 queue；消费者 acquire buffer、等待同步 fence、使用后 release。两端通过 Binder 接口协作，但 buffer 的实际内存、槽位状态和同步对象拥有独立生命周期。

```text
应用渲染 → ANativeWindow/Surface → BufferQueueProducer
→ BufferQueueCore → BufferQueueConsumer → SurfaceFlinger → 合成/显示
```

队列槽位有限。生产者过快会被背压，消费者过慢会导致帧延迟；这也是理解掉帧、jank 和 buffer starvation 的基础。

## Fence 与同步

fence 表达 GPU、显示硬件和 CPU 之间的完成依赖。不能因为拿到 buffer 对象就假设内容已可读写；必须按 acquire/release fence 的协议等待或传递。错误处理 fence 会造成花屏、卡死或无谓阻塞。

## SurfaceFlinger 的位置

SurfaceFlinger 管理图层状态和事务，在合适时机采集各层 buffer，交给硬件合成器或 GPU 合成后提交显示。它并不直接替应用绘制内容，而是协调缓冲区、图层、显示设备与合成时序。

## 源码阅读路线

先从 `frameworks/native/libs/gui/` 的 `Surface`、`BufferQueueProducer`、`BufferQueueConsumer` 建立对象图，再读 SurfaceFlinger 如何接收图层事务和 latch buffer。每一步记录 buffer 谁拥有、slot 状态如何变、在哪个线程运行、fence 何时交接。

## 易错点

- BufferQueue 不是简单 FIFO：它有槽位、状态机、fence 和丢帧策略。
- `SurfaceControl` 管图层/事务，`Surface`/ANativeWindow 是生产 buffer 的入口，二者角色不同。
- 不要脱离显示刷新和合成时机讨论“一帧已经显示”。
