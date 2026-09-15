# Unix Socket：同一台设备上的双向字节通道

Unix Domain Socket 使用文件描述符提供本机进程间通信。`SOCK_STREAM` 给出可靠、有序的字节流，但不保留每次 `write` 的消息边界；应用层仍要定义长度、版本和错误处理协议。

## 1. socketpair 先建立最小模型

`socketpair(AF_UNIX, SOCK_STREAM, 0, fds)` 一次得到两个已连接端点，适合父子进程或本地测试。常规服务则使用 `socket → bind → listen → accept`，客户端使用 `socket → connect`。

返回的只是两个 fd。复制数字不等于复制所有权，结束时每个拥有者都要关闭自己的端点，并使用 `SOCK_CLOEXEC` 或 `fcntl` 控制是否跨 `exec` 继承。

## 2. 完整示例：使用长度前缀收发消息

```cpp title="unix_socket_demo.cpp"
#include <sys/socket.h>
#include <unistd.h>

#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

bool writeAll(int fd, const void* data, std::size_t size) {
    const auto* bytes = static_cast<const char*>(data);
    while (size > 0) {
        const ssize_t written = write(fd, bytes, size);
        if (written <= 0) return false;
        bytes += written;
        size -= static_cast<std::size_t>(written);
    }
    return true;
}

bool readAll(int fd, void* data, std::size_t size) {
    auto* bytes = static_cast<char*>(data);
    while (size > 0) {
        const ssize_t received = read(fd, bytes, size);
        if (received <= 0) return false;
        bytes += received;
        size -= static_cast<std::size_t>(received);
    }
    return true;
}

bool sendMessage(int fd, const std::string& text) {
    const std::uint32_t size = static_cast<std::uint32_t>(text.size());
    return writeAll(fd, &size, sizeof(size)) && writeAll(fd, text.data(), text.size());
}

std::string receiveMessage(int fd) {
    std::uint32_t size = 0;
    if (!readAll(fd, &size, sizeof(size)) || size > 4096) {
        throw std::runtime_error("bad message");
    }
    std::string text(size, '\0');
    if (!readAll(fd, text.data(), text.size())) throw std::runtime_error("short message");
    return text;
}

int main() {
    int sockets[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sockets) == -1) return 1;

    std::thread server([fd = sockets[1]] {
        const std::string request = receiveMessage(fd);
        sendMessage(fd, "ack:" + request);
        close(fd);
    });

    sendMessage(sockets[0], "hello");
    std::cout << receiveMessage(sockets[0]) << '\n';
    close(sockets[0]);
    server.join();
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic -pthread unix_socket_demo.cpp -o unix_socket_demo
./unix_socket_demo
```

输出 `ack:hello`。`readAll`/`writeAll` 循环处理短读短写，长度前缀恢复消息边界，并先限制最大长度再分配内存。

## 3. 真实协议还缺什么

示例只适用于同一机器、相同整数表示的两端。长期协议应规定字节序、版本、最大长度、超时、断开重连和认证。Android 上还要考虑 socket 文件权限、SELinux、对端凭据以及 fd 是否意外泄漏。`socketpair` 的正式语义见 [POSIX socketpair](https://pubs.opengroup.org/onlinepubs/9799919799/functions/socketpair.html)。
