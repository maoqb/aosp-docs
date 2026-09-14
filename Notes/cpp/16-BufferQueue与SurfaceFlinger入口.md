# BufferQueue 与 SurfaceFlinger 入口

当天目标：建立 Android 图形 Native 代码最重要的一条调用链地图。

- BufferQueue 连接生产者和消费者；应用侧提交 buffer，系统侧消费并合成。
- `Surface`、`ANativeWindow`、`BufferQueueProducer` 的角色不同，要先画对象关系。
- SurfaceFlinger 接收事务和 buffer 后决定图层状态、合成时机和显示输出。
- 不要从 SurfaceFlinger 大类逐行读；先追一帧 buffer 的提交和消费链路。

练习：从 `SurfaceControl` 或 `Surface` 的一个入口开始，画到 BufferQueue 的调用图。
