# vscode调试aosp的native代码

参考官方文档：<https://source.android.com/docs/core/tests/debug/gdb?hl=zh-cn#debug-with-vs-code>

#### 1.vscode安装CodeLLDB插件

![image](vscode%E8%B0%83%E8%AF%95aosp%E7%9A%84native%E4%BB%A3%E7%A0%81.assets/img-1744c65939.png)

#### 2.创建调试配置文件

在 AOSP 根目录下创建 `.vscode/launch.json`：

```json
{
    "version": "0.2.0",
    "configurations": [
        // #lldbclient-generated-begin
        // #lldbclient-generated-end
    ]
}
```

AOSP 的脚本会在两行注释之间自动填写程序、符号路径和连接配置。

#### 3.让调试脚本启动 `service list`

```bash
lldbclient.py \
  --setup-forwarding vscode-lldb \
  --vscode-launch-file "$ANDROID_BUILD_TOP/.vscode/launch.json" \
  -r /system/bin/service list
```

`--setup-forwarding`：让脚本搭好调试连接，等待外部调试器接入。

脚本会在模拟器中启动调试服务，并生成 VS Code 配置。

出现：

```
Press enter to shut down lldb-server
```

保持该终端运行，先不要按回车。

![image](vscode%E8%B0%83%E8%AF%95aosp%E7%9A%84native%E4%BB%A3%E7%A0%81.assets/img-f0409f1ee2.png)

#### 4.在 libbinder 源码中下断点

![image](vscode%E8%B0%83%E8%AF%95aosp%E7%9A%84native%E4%BB%A3%E7%A0%81.assets/img-f0ae5a0289.png)

#### 5.开始调试

![image](vscode%E8%B0%83%E8%AF%95aosp%E7%9A%84native%E4%BB%A3%E7%A0%81.assets/img-06e28a318d.png)

#### 6.持续追踪

![image](vscode%E8%B0%83%E8%AF%95aosp%E7%9A%84native%E4%BB%A3%E7%A0%81.assets/img-725202f023.png)

#### 7.常用参数

| 参数 | 作用 | 示例 |
| --- | --- | --- |
| -r 程序 参数 | 启动新进程并调试 | -r /system/bin/service list |
| -p PID | 附加到指定进程 | -p 1234 |
| -n 名称 | 按进程名称附加 | -n servicemanager |
| -s 序列号 | 指定 Android 设备 | -s emulator-5554 |
| --port 端口 | 指定电脑上的转发端口，默认 5039 | --port 5040 |
| --setup-forwarding vscode-lldb | 准备连接，生成 CodeLLDB 配置 | 你现在使用的模式 |
| --vscode-launch-file 路径 | 将配置写入指定文件 | --vscode-launch-file .vscode/launch.json |
| --vscode-launch-props JSON | 给生成的配置追加属性 | 追加 initCommands 等 |
| --env 名称=值 | 设置被启动程序的环境变量，可重复指定 | --env MY_DEBUG=1 |
| --cwd 路径 | 设置程序在设备上的工作目录 | --cwd /data/local/tmp |
| --extra-cmds-file 文件 | 从文件加载额外 LLDB 命令 | 用于命令行 LLDB 模式 |

`-p`**、**`-n`**、**`-r` **三选一；使用** `-r` **时，把它及程序参数放在整条命令最后。** 如果同名进程有多个，用 `-p` 明确指定 PID。

比如，你现在调试的是 `service` 客户端。如果想调试已经运行的 **servicemanager 服务端**，可以在结束当前会话后执行：

```bash
lldbclient.py \
  --setup-forwarding vscode-lldb \
  --vscode-launch-file "$ANDROID_BUILD_TOP/.vscode/launch.json" \
  -n servicemanager
```