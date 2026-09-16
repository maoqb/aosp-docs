# Android c++环境搭建

最终目标：

```
VS Code 写代码
    ├── clangd 提供补全、类型提示、源码跳转
    └── Soong 编译 → adb 部署 → 模拟器运行
```

# 一、生成编译数据库

## 1\. 初始化 AOSP 编译环境

在终端执行：

```
cd ~/code/android-16.0.0_r4

source build/envsetup.sh

lunch sdk_phone64_x86_64-trunk_staging-eng
```

如果以后换产品，`lunch` 应使用那个产品原先编译成功的配置。

## 2\. 开启编译数据库生成

继续在**同一个终端**执行：

```
export SOONG_GEN_COMPDB=1
export SOONG_LINK_COMPDB_TO="$PWD"
```

两个变量的含义：

| 变量 | 作用 |
| --- | --- |
| SOONG_GEN_COMPDB=1 | 让 Soong 生成编译数据库 |
| SOONG_LINK_COMPDB_TO="$PWD" | 在当前源码根目录创建数据库软链接 |

然后执行：

```
m -j4 nothing
```

这个目标会处理构建配置，并触发编译数据库生成。

## 3\. 检查生成结果

```
ls -lh out/soong/development/ide/compdb/compile_commands.json

ls -l compile_commands.json

readlink -f compile_commands.json
```

预期关系是：

```
android-16.0.0_r4/compile_commands.json
    ↓ 软链接
android-16.0.0_r4/out/soong/development/ide/compdb/compile_commands.json
```

**检查点：实际 JSON 文件存在且非空，软链接能指向它。**

数据库可能很大，使用终端检查即可。

### 这个文件为什么重要？

它记录了各个源文件的真实编译参数，包括：

- Android 头文件搜索路径。
- 生成头文件的路径。
- 宏定义。
- C++ 标准。
- 编译器和目标架构。

clangd 读取这些信息后，才能理解 `BBinder`、`Parcel` 等类型。[clangd 项目配置说明](https://clangd.llvm.org/installation#project-setup)

# 二、编译一次准备开发的模块

AOSP 整体编译成功，并不意味着每个测试模块都已经编译过。

针对当前例子执行：

```
m -j4 binderAddInts
```

这一步会生成该模块及依赖需要的构建产物，包括可能用到的生成头文件。

检查程序是否生成：

```
ls -l \
  out/target/product/emu64x/data/benchmarktest64/binderAddInts/binderAddInts
```

**检查点：模块编译成功，并且可执行文件存在。**

# 三、准备 clangd 程序和扩展

## 1\. 确认 AOSP 自带的 clangd 能运行

在源码根目录执行：

```
prebuilts/clang/host/linux-x86/clang-r563880c/bin/clangd --version
```

当前这份源码应能显示类似：

```
clangd version 21.0.0
```

这里使用的 `clang-r563880c` 对应你当前源码的工具链。换 AOSP 版本后需要重新核对。

## 2\. 在 VS Code 安装并启用 clangd 扩展

打开扩展面板，搜索：

```
clangd
```

确认扩展标识为：

```
llvm-vs-code-extensions.vscode-clangd
```

# 四、配置 VS Code 工作区

## 1\. 打开源码根目录

通过 VS Code 的“文件 → 打开文件夹”选择：

```
/home/mao/code/android-16.0.0_r4
```

后续配置均放在这个根目录下。

## 2\. 创建配置文件

目录结构：

```
android-16.0.0_r4/
├── .vscode/
│   └── settings.json
├── compile_commands.json
├── frameworks/
├── system/
└── ...
```

vscode中按 `Ctrl + Shift + P`，输入并选择：

```
Preferences: Open Workspace Settings (JSON)
```

中文版对应：

```
首选项: 打开工作区设置(JSON)
```

在 `.vscode/settings.json` 中填写：

```
{
    "clangd.path": "/home/mao/code/android-16.0.0_r4/prebuilts/clang/host/linux-x86/clang-r563880c/bin/clangd",
    "clangd.arguments": [
        "--background-index",
        "--background-index-priority=low",
        "-j=2"
    ],
    "C_Cpp.intelliSenseEngine": "disabled"
}
```

配置说明：

| 配置 | 作用 |
| --- | --- |
| clangd.path | 指定 AOSP 自带的 clangd |
| --background-index | 开启后台索引，支持跨文件导航 |
| --background-index-priority=low | 降低索引任务的 CPU 优先级 |
| -j=2 | 使用两个工作线程 |
| C_Cpp.intelliSenseEngine | 让 clangd 负责当前工作区的 C++ 语义解析 |

clangd 会沿源文件的父目录寻找编译数据库，因此根目录软链接建立好后，就可以自动发现它。

# 五、启动并验证补全、跳转

## 1\. 重启语言服务

打开 `binderAddInts.cpp`，按：

```
Ctrl+Shift+P
```

执行：

```
clangd: Restart language server
```

如果扩展没有启动，再执行：

```
Developer: Reload Window
```

## 2\. 查看日志

打开：

```
查看 → 输出 → 选择 clangd 对应的输出通道
```

确认日志中出现类似：

```
Loaded compilation database from .../compile_commands.json
```

首次全库索引需要时间，跨文件查询结果会逐步完善。

## 3\. 进行三个实际测试

### 测试 A：类型跳转

找到：

```
class AddIntsService : public BBinder
```

在 `BBinder` 上按 **F12**。

预期能定位到 `Binder.h` 中的类定义。

### 测试 B：函数跳转

找到：

```
proc->startThreadPool();
```

在 `startThreadPool` 上按 **F12**。

预期能定位到声明或定义；实现位于 `ProcessState.cpp`。

### 测试 C：成员补全

在函数内已有：

```
Parcel send, reply;
```

的位置之后，临时输入：

```
send.
```

预期出现 `writeInt32` 等成员提示，也可以按 **Ctrl+Space** 触发。测试后删除临时输入。

对于：

```
binder->transact(...)
```

F12 可能定位到 `IBinder` 接口声明。要查看 `BBinder`、`BpBinder` 等实现，使用右键 **“转到实现”**。

# 六、配置 VS Code 编译快捷键

创建 `.vscode/tasks.json`：

```
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "AOSP: build binderAddInts",
            "type": "process",
            "command": "/bin/bash",
            "args": [
                "-c",
                "source build/envsetup.sh && lunch sdk_phone64_x86_64-trunk_staging-eng && m -j4 binderAddInts"
            ],
            "options": {
                "cwd": "${workspaceFolder}",
                "env": {
                    "SOONG_GEN_COMPDB": "1",
                    "SOONG_LINK_COMPDB_TO": "${workspaceFolder}"
                }
            },
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "problemMatcher": [
                "$gcc"
            ]
        }
    ]
}
```

保存后，按：

```
Ctrl+Shift+B
```

就会编译 `binderAddInts`，构建输出显示在 VS Code 终端中。

以后开发其他模块，将任务中的模块名和对应产品配置改掉即可。

# 七、部署到模拟器运行

启动与你所选产品对应的模拟器，然后检查设备：

```
adb devices -l
```

下面以 `emulator-5554` 为例。对于当前 `eng` 测试镜像，可以执行：

```
adb -s emulator-5554 root
adb -s emulator-5554 wait-for-device
```

推送程序：

```
adb -s emulator-5554 push \
  out/target/product/emu64x/data/benchmarktest64/binderAddInts/binderAddInts \
  /data/local/tmp/binderAddInts
```

运行：

```
adb -s emulator-5554 shell \
  /data/local/tmp/binderAddInts
```

**检查点：程序正常执行，并打印 benchmark 结果。**

之后修改代码，就重复：

```
保存代码 → Ctrl+Shift+B → adb push → adb shell 运行
```

# 八、以后什么时候更新数据库？

| 变化 | 操作 |
| --- | --- |
| 只改已有函数内部代码 | clangd 通常自动重新解析 |
| 新增 .cpp 文件 | 加入 Android.bp 的 srcs，重新构建 |
| 修改依赖库、宏或编译选项 | 在启用 SOONG_GEN_COMPDB 的环境中重新构建 |
| 切换产品或源码分支 | 重新 lunch、构建并更新数据库 |
| 缺少 AIDL 等生成头文件 | 编译对应模块及其依赖 |

需要单独刷新数据库时，在初始化好的终端执行：

```
export SOONG_GEN_COMPDB=1
export SOONG_LINK_COMPDB_TO="$PWD"
m -j4 nothing
```

如果编辑器没有加载变化，再执行一次 `clangd: Restart language server`。

---

**搭建完成的三个标准：**

1. `BBinder` 能跳转，`Parcel` 成员有补全。
2. `Ctrl+Shift+B` 能编译成功。
3. 新程序推送到模拟器后能运行。