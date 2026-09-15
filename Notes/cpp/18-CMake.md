# CMake：用 target 描述怎样构建程序

CMake 不是编译器。它读取 `CMakeLists.txt`，生成 Ninja、Makefile 等底层构建规则。理解 CMake 时应围绕 **target（构建目标）**：某个可执行文件或库有哪些源码、头文件路径、编译特性和依赖。

## 1. 最小项目的四件事

```cmake
cmake_minimum_required(VERSION 3.16)
project(cpp_notes LANGUAGES CXX)
add_executable(hello main.cpp)
target_compile_features(hello PRIVATE cxx_std_17)
```

`project` 初始化项目和语言；`add_executable` 建立目标；`target_compile_features` 把 C++17 要求挂到目标上。尽量使用 `target_*` 命令，避免把全局编译选项无差别施加给所有依赖。

## 2. 完整示例：库、头文件和可执行文件

目录：

```text
cmake_demo/
├── CMakeLists.txt
├── app/main.cpp
├── include/calculator.h
└── src/calculator.cpp
```

```cpp title="include/calculator.h"
#pragma once

namespace demo {
int add(int left, int right);
}
```

```cpp title="src/calculator.cpp"
#include "calculator.h"

int demo::add(int left, int right) {
    return left + right;
}
```

```cpp title="app/main.cpp"
#include "calculator.h"

#include <iostream>

int main() {
    std::cout << demo::add(20, 22) << '\n';
}
```

```cmake title="CMakeLists.txt"
cmake_minimum_required(VERSION 3.16)
project(cpp_notes LANGUAGES CXX)

add_library(calculator src/calculator.cpp)
target_include_directories(calculator PUBLIC include)
target_compile_features(calculator PUBLIC cxx_std_17)

add_executable(calculator_demo app/main.cpp)
target_link_libraries(calculator_demo PRIVATE calculator)
```

构建时把生成文件放到源码目录之外：

```bash
cmake -S . -B build
cmake --build build
./build/calculator_demo
```

输出 `42`。

## 3. PUBLIC、PRIVATE、INTERFACE 说的是传播关系

以 `target_include_directories(calculator PUBLIC include)` 为例：

- `PRIVATE`：只有 `calculator` 自己编译时需要。
- `INTERFACE`：`calculator` 自己不需要，消费者需要。
- `PUBLIC`：自己和消费者都需要。

头文件 `calculator.h` 是消费者编译 `main.cpp` 的必要条件，所以这里使用 `PUBLIC`。链接依赖同样要问：这个库只在实现中使用，还是出现在公开接口中并需要继续传播？

## 4. 常见错误怎么定位

| 表现 | 优先检查 |
| --- | --- |
| `header not found` | `target_include_directories` 及传播范围 |
| `undefined reference` | 源文件是否进了库、目标是否 `target_link_libraries` |
| 改选项不生效 | 选项是否挂在真正编译该源文件的 target 上 |
| 换编译器后仍用旧结果 | 清理或换一个 build 目录重新 configure |

CMake 官方教程把 `add_executable`、`add_library`、`target_sources`、`target_link_libraries` 作为核心 target 命令；完整语义以 [CMake Tutorial](https://cmake.org/cmake/help/latest/guide/tutorial/index.html) 为准。AOSP 平台主体使用 Soong，但 target 与依赖传播的思考方式仍然有帮助。
