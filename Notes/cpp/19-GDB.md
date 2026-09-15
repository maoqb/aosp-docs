# GDB：让猜测变成现场证据

GDB 可以暂停程序、查看变量、调用栈和线程。调试的目标不是把命令背全，而是在“程序为什么走到这里”与具体源码、参数和内存状态之间建立证据。

## 1. 先生成可调试二进制

```bash
g++ -std=c++17 -g3 -O0 -Wall -Wextra -Wpedantic gdb_demo.cpp -o gdb_demo
gdb ./gdb_demo
```

`-g3` 写入调试信息，`-O0` 让源码与执行顺序较容易对应。优化构建也能调试，但变量可能被优化掉，函数可能被内联。

## 2. 完整示例

```cpp title="gdb_demo.cpp"
#include <iostream>
#include <vector>

int sum(const std::vector<int>& values) {
    int total = 0;
    for (int value : values) {
        total += value;
    }
    return total;
}

int main() {
    std::vector<int> values{10, 20, 12};
    std::cout << sum(values) << '\n';
}
```

启动后可以依次执行：

```gdb
break sum
run
info args
next
print total
display total
continue
quit
```

- `break` 设置断点，`run` 启动程序。
- `next` 执行下一源码行但不进入函数，`step` 会进入函数。
- `print expression` 求值并显示，`display` 在每次暂停时重复显示。
- `continue` 运行到下一个断点或程序结束。

## 3. 调用栈告诉你“谁调用到这里”

```gdb
backtrace
frame 1
info locals
```

`backtrace`（常简写 `bt`）从当前函数向调用者列出栈帧；`frame` 切换观察的栈帧。崩溃点经常只是最后一次非法访问，仍要沿调用链寻找对象在哪里被释放或参数在哪里变坏。

## 4. 条件断点和观察点

```gdb
break worker.cpp:80 if request_id == 42
watch state
```

条件断点只在条件成立时停下。`watch` 尝试在表达式值变化时暂停，硬件观察点数量有限，并且观察对象必须仍然存活。

## 5. 多线程与 core dump

```gdb
info threads
thread 3
thread apply all backtrace
```

死锁现场不要只看当前线程；所有线程的栈才能组成等待关系。分析 core dump 时使用与崩溃版本严格匹配、未剥离符号的二进制：

```bash
gdb ./my_program core
```

Android 设备日常更常使用 LLDB、`lldb-server`、tombstone 和 `llvm-symbolizer`，但断点、栈帧、变量、线程这些核心概念相同。命令细节见 [GNU GDB 官方手册](https://sourceware.org/gdb/current/onlinedocs/gdb)。
