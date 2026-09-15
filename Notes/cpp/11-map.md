# map：按键查值，而不是按位置取元素

`std::map` 和 `std::unordered_map` 都保存键值对。前者按键排序，后者按哈希桶组织；选择时先看是否需要有序遍历、范围查询和稳定的最坏情况，而不是只看平均速度。

## 1. map 与 unordered_map 怎么选

| 容器 | 顺序 | 常见查找复杂度 | 适合场景 |
| --- | --- | --- | --- |
| `std::map` | 按比较器排序 | `O(log n)` | 有序输出、`lower_bound`、范围查找 |
| `std::unordered_map` | 无稳定顺序 | 平均 `O(1)` | 只关心按键快速查找 |

`unordered_map` 的最坏情况可以退化，扩容还会使迭代器失效。不要把某次运行的遍历顺序写进协议或测试期望。

## 2. operator[] 会插入不存在的键

```cpp
std::map<std::string, int> counts;
int value = counts["missing"]; // 插入 {"missing", 0}
```

只想查询时用 `find`：

```cpp
auto it = counts.find("missing");
if (it != counts.end()) {
    std::cout << it->second;
}
```

`at` 不插入，但找不到会抛 `std::out_of_range`。更新语义也应写清：`insert` 不覆盖，`insert_or_assign` 会覆盖，`try_emplace` 只在键不存在时构造值。

## 3. 完整示例：统计并按字母输出单词

```cpp title="map_demo.cpp"
#include <iostream>
#include <map>
#include <sstream>
#include <string>

int main() {
    std::istringstream input("binder surface binder audio surface binder");
    std::map<std::string, int> counts;

    for (std::string word; input >> word;) {
        ++counts[word];
    }

    for (const auto& [word, count] : counts) {
        std::cout << word << '=' << count << '\n';
    }
}
```

```bash
g++ -std=c++17 -Wall -Wextra -Wpedantic map_demo.cpp -o map_demo
./map_demo
```

输出按键排序：

```text
audio=1
binder=3
surface=2
```

`const auto& [word, count]` 是**结构化绑定**：给键和值分别起局部名字，同时用引用避免复制。

## 4. 删除时使用 erase 返回值

```cpp
for (auto it = counts.begin(); it != counts.end();) {
    if (it->second == 0) {
        it = counts.erase(it);
    } else {
        ++it;
    }
}
```

关联容器删除一个元素通常不会让其他元素的迭代器失效，但被删除元素的迭代器当然不能再用。容器只管理元素，不自动保证多线程访问安全；共享 map 的读写仍需锁或线程封闭。

规则细节可查 C++17 工作草案 N4659 的 `[map]`、`[unord.map]` 与 `[associative.reqmts]`。
