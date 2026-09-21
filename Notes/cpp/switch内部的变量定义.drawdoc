# switch内部的变量定义

c++规定，不允许跨过变量的初始化语句直接跳转到该变量作用域的另一位置

#### 实验1

```cpp
#include<iostream>

int main() {
        int cmd = 2;
        switch (cmd) {
        case 1:
            int value = 10;
            std::cout << "case 1: value = " << value << '\n';
            break;

        case 2:
           std::cout << "case 2\n"; 
            break;
        }
}
```

编译报错：

```bash
switch_case.cpp: In function ‘int main()’:
switch_case.cpp:11:14: error: jump to case label
   11 |         case 2:
      |              ^
switch_case.cpp:7:17: note:   crosses initialization of ‘int value’
    7 |             int value = 10;
      |                 ^~~~~
```

#### 实验2

```cpp
#include<iostream>

int main() {
        int cmd = 2;
        switch (cmd) {
        case 1:
            int value;
            std::cout << "case 1: value = " << value << '\n';
            break;

        case 2:
           std::cout << "case 2\n"; 
            break;
        }
}
```

编译成功，运行结果如下：

```plaintext
case 2
```

#### 实验3

```cpp
#include<iostream>

int main() {
        int cmd = 2;
        switch (cmd) {
        case 1:
            std::string value;
            std::cout << "case 1: value = " << value << '\n';
            break;

        case 2:
           std::cout << "case 2\n"; 
            break;
        }
}
```

编译报错：

```bash
switch_case.cpp: In function ‘int main()’:
switch_case.cpp:11:14: error: jump to case label
   11 |         case 2:
      |              ^
switch_case.cpp:7:25: note:   crosses initialization of ‘std::string value’
    7 |             std::string value;
      |                         ^~~~~
```

#### 实验4

```cpp
#include<iostream>

int main() {
        int cmd = 2;
        switch (cmd) {
        case 1:{
                    std::string value = "zhangsan";
                    std::cout << "case 1: value = " << value << '\n';
                    break;
       }
        case 2:
           std::cout << "case 2\n"; 
            break;
        }
}
```

编译成功，运行结果如下：

```plaintext
case 2
```