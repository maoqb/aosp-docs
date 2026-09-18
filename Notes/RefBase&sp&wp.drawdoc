# RefBase、sp、wp

> `RefBase + sp + wp` 就是 Android 自己的一套**侵入式引用计数生命周期管理机制**。

## 1、三者分工

<table style="min-width: 407px;"><colgroup><col style="width: 176px;"><col style="width: 206px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1" colwidth="176"><p>类型</p></th><th colspan="1" rowspan="1" colwidth="206"><p>本质</p></th><th colspan="1" rowspan="1"><p>作用</p></th></tr><tr><td colspan="1" rowspan="1" colwidth="176"><p><code>RefBase</code></p></td><td colspan="1" rowspan="1" colwidth="206"><p>基类</p></td><td colspan="1" rowspan="1"><p>给对象提供引用计数能力</p></td></tr><tr><td colspan="1" rowspan="1" colwidth="176"><p><code>sp&lt;T&gt;</code></p></td><td colspan="1" rowspan="1" colwidth="206"><p>强智能指针</p></td><td colspan="1" rowspan="1"><p>强引用 T，影响 T 的生命周期</p></td></tr><tr><td colspan="1" rowspan="1" colwidth="176"><p><code>wp&lt;T&gt;</code></p></td><td colspan="1" rowspan="1" colwidth="206"><p>弱智能指针</p></td><td colspan="1" rowspan="1"><p>弱引用 T，不要求 T 继续存活</p></td></tr></tbody></table>

## 2、sp&lt;T&gt;

```
class Person : public RefBase {
public:
    Person() {
        printf("Person constructor\n");
    }

    ~Person() {
        printf("Person destructor\n");
    }
};
```

然后，`sp<Person>` 强持有它

```
sp<Person> p = sp<Person>::make();
```

<p><span style="color: rgb(223, 12, 75);">sp到底是指针还是引用？？？</span></p>

类型层面：`sp<T>` **是一个 C++ 智能指针类**；生命周期语义层面：**它对目标建立 strong reference（强引用）。**

## 3、wp&lt;T&gt;

为什么需要wp，因为两个对象互相持有的情况下，对象无法释放。

```
class Parent : public RefBase {
public:
    sp<Child> child;
};

class Child : public RefBase {
public:
    sp<Parent> parent;
};
```

把：

```
sp<Parent> parent;
```

改成：

```
wp<Parent> parent;
```

关系变成：

```
Parent
  │
  │ sp 强引用
  ▼
Child
  │
  │ wp 弱引用
  └────────→ Parent
```

关键：`wp` **不会像** `sp` **一样要求目标对象必须继续活着。**

## **4、wp指向的对象死了怎么办？**

既然`wp` 不会像 `sp` 一样要求目标对象必须继续活着，那wp指向的对象死了怎么办？

这么办：promote()

假设：

```
wp<Person> weak;

{
    sp<Person> strong = sp<Person>::make();

    weak = strong;

} // strong消失
```

现在：

```
weak
 │
 │ 弱引用关系仍存在
 ▼
Person？

Person可能已经析构
```

所以 Android 不允许你把 `wp` 当成一个“保证对象活着”的普通指针使用。

你需要：

```
sp<Person> person = weak.promote();
```

尝试通过若引用获取一个强引用