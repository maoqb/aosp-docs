# ioctl

<p><span style="color: rgb(32, 32, 32);">Binder ioctl 是用户空间和 binder 驱动之间唯一的通信入口，</span><code>/dev/binder</code><span style="color: rgb(32, 32, 32);"> 打开后所有操作都靠这一个系统调用完成。</span></p>

<p><span style="color: rgb(32, 32, 32);">用户侧的ioctl对应binder驱动中的binder_ioctl</span></p>

```cpp
static long binder_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
{
	int ret;
        // 同一个binder设备只open一次（进程级单例fd）；但一个进程可以合法地open多个不同的binder设备（binder/hwbinder/vndbinder），各自产生独立的binder_proc
	struct binder_proc *proc = filp->private_data;
	struct binder_thread *thread;
	unsigned int size = _IOC_SIZE(cmd);
        // ubuf就是用户空间传进来的那个指针
	void __user *ubuf = (void __user *)arg;
        ...
        thread = binder_get_thread(proc);
	if (thread == NULL) {
		ret = -ENOMEM;
		goto err;
	}

	switch (cmd) {
	case xxx:
		ret = xxx;
		if (ret)
			goto err;
		break;
        ...
	return ret;
}
```

<p><span style="color: rgb(32, 32, 32);">命令集定义在 </span><code>kernel/5.15_14/include/uapi/linux/android/binder.h</code><span style="color: rgb(32, 32, 32);">，用标准的 </span><code>_IOWR</code><span style="color: rgb(32, 32, 32);">/</span><code>_IOW</code><span style="color: rgb(32, 32, 32);"> 宏封装了方向和数据类型：</span></p>

```c
#define BINDER_WRITE_READ		_IOWR('b', 1, struct binder_write_read)
#define BINDER_SET_IDLE_TIMEOUT		_IOW('b', 3, __s64)
#define BINDER_SET_MAX_THREADS		_IOW('b', 5, __u32)
#define BINDER_SET_IDLE_PRIORITY	_IOW('b', 6, __s32)
#define BINDER_SET_CONTEXT_MGR		_IOW('b', 7, __s32)
#define BINDER_THREAD_EXIT		_IOW('b', 8, __s32)
#define BINDER_VERSION			_IOWR('b', 9, struct binder_version)
#define BINDER_GET_NODE_DEBUG_INFO	_IOWR('b', 11, struct binder_node_debug_info)
#define BINDER_GET_NODE_INFO_FOR_REF	_IOWR('b', 12, struct binder_node_info_for_ref)
#define BINDER_SET_CONTEXT_MGR_EXT	_IOW('b', 13, struct flat_binder_object)
#define BINDER_FREEZE			_IOW('b', 14, struct binder_freeze_info)
#define BINDER_GET_FROZEN_INFO		_IOWR('b', 15, struct binder_frozen_status_info)
#define BINDER_ENABLE_ONEWAY_SPAM_DETECTION	_IOW('b', 16, __u32)
```

#### BINDER_VERSION

用户态

```cpp
// frameworks/native/libs/binder/ProcessState.cpp
status_t result = ioctl(fd, BINDER_VERSION, &vers);
```

内核态

```c
// kernel/5.15_14/drivers/android/binder.c	
       case BINDER_VERSION: {
		struct binder_version __user *ver = ubuf;
                // 检查用户空间在编译BINDER_VERSION这个宏时，它认为的 struct binder_version大小，跟内核这边sizeof出来的是否一致
                // 不一致说明用户态和内核态的ABI不匹配（比如头文件版本对不上），直接返回-EINVAL拒绝，不敢往下写数据，防止内存越界。
		if (size != sizeof(struct binder_version)) {
			ret = -EINVAL;
			goto err;
		}
                // put_user()是内核标准的"安全写用户空间内存"接口（跟copy_to_user类似，但针对单个标量值更高效，内部会做地址合法性检查、处理跨用户/内核边界的异常）
                // 这里把内核定义的常量 BINDER_CURRENT_PROTOCOL_VERSION写进用户传来的ver->protocol_version这个字段里
                // put_user失败（比如传进来的指针根本不是有效的用户空间地址）就返回-EINVAL。
		if (put_user(BINDER_CURRENT_PROTOCOL_VERSION,
			     &ver->protocol_version)) {
			ret = -EINVAL;
			goto err;
		}
		break;
	}
```

#### BINDER_SET_MAX_THREADS

用户态

```cpp
// frameworks/native/libs/binder/ProcessState.cpp
size_t maxThreads = DEFAULT_MAX_BINDER_THREADS; // 15
result = ioctl(fd, BINDER_SET_MAX_THREADS, &maxThreads);
```

内核态

```c
	case BINDER_SET_MAX_THREADS: {
		int max_threads;
                // copy_from_user把用户空间传进来的整数值（ubuf指向用户传的&maxThreads）拷贝到内核栈变量max_threads里
		if (copy_from_user(&max_threads, ubuf, sizeof(max_threads))) {
			ret = -EINVAL;
			goto err;
		}
		binder_inner_proc_lock(proc);
                // `proc->max_threads`记录了这个进程binder线程池允许创建的最大线程数上限
                // 当驱动处理一个跨进程事务时，如果发现目标进程当前所有binder线程都在忙、没有空闲线程能接活，会检查`proc->max_threads`
                // ——如果还没到上限，就给目标进程发一个`BR_SPAWN_LOOPER`命令，让用户空间的`IPCThreadState`/线程池管理逻辑动态生成一个新的binder线程去处理；
                // 如果已经到了上限，就不会再要求生成新线程，多余的请求得排队等现有线程忙完。
		proc->max_threads = max_threads;
		binder_inner_proc_unlock(proc);
		break;
	}
```

#### BINDER_SET_CONTEXT_MGR_EXT

用户态

```cpp
bool ProcessState::becomeContextManager()
{
    AutoMutex _l(mLock);

    flat_binder_object obj {
        // FLAT_BINDER_FLAG_TXN_SECURITY_CTX标志，表示希望后续发给这个context manager节点的事务附带调用者的SELinux安全上下文
        .flags = FLAT_BINDER_FLAG_TXN_SECURITY_CTX,
    };
    // 优先用新接口BINDER_SET_CONTEXT_MGR_EXT
    int result = ioctl(mDriverFD, BINDER_SET_CONTEXT_MGR_EXT, &obj);

    // fallback to original method
    // 如果失败（比如运行在旧内核，不支持这个新ioctl），回退到老接口BINDER_SET_CONTEXT_MGR
    if (result != 0) {
        android_errorWriteLog(0x534e4554, "121035042");

        int unused = 0;
        // 老接口不带flat_binder_object，只传个占位的unused
        result = ioctl(mDriverFD, BINDER_SET_CONTEXT_MGR, &unused);
    }

    if (result == -1) {
        ALOGE("Binder ioctl to become context manager failed: %s\n", strerror(errno));
    }

    return result == 0;
}
```

内核态

```cpp
	// 新接口
        case BINDER_SET_CONTEXT_MGR_EXT: {
                // 在内核栈上新建一个完整的struct flat_binder_object对象
		struct flat_binder_object fbo;
                // 把用户空间那块内存的原始字节拷贝进来
		if (copy_from_user(&fbo, ubuf, sizeof(fbo))) {
			ret = -EINVAL;
			goto err;
		}
		ret = binder_ioctl_set_ctx_mgr(filp, &fbo);
		if (ret)
			goto err;
		break;
	}
        // 老接口
	case BINDER_SET_CONTEXT_MGR:
		ret = binder_ioctl_set_ctx_mgr(filp, NULL);
		if (ret)
			goto err;
		break;
```

新老接口最终都会调用binder_ioctl_set_ctx_mgr，只是新接口携带了flat_binder_object的参数

```c
static int binder_ioctl_set_ctx_mgr(struct file *filp, struct flat_binder_object *fbo)
{
	int ret = 0;
        // 一个binder设备对应一个binder_proc
	struct binder_proc *proc = filp->private_data;
	struct binder_context *context = proc->context;
	struct binder_node *new_node;
	kuid_t curr_euid = current_euid();

	mutex_lock(&context->context_mgr_node_lock);
        // 检查binder_context_mgr_node是否已经被设置过
        // 一旦有一个进程成功注册过，这个字段就非空，后面任何进程（包括同一个进程再调一次）都会被拒绝，返回-EBUSY
        // 这正是"一个binder设备只能有一个context manager"这条规则的落地实现
	if (context->binder_context_mgr_node) {
		pr_err("BINDER_SET_CONTEXT_MGR already set\n");
		ret = -EBUSY;
		goto out;
	}
        // 调用LSM（Linux Security Module）钩子，用调用进程的proc->cred（凭证，在binder_open时保存的filp->f_cred）去检查SELinux策略是否允许这个域成为context manager
        // 在AOSP的SELinux策略里，通常只有servicemanager这个域被授权，普通app域调这个ioctl会在这里被拦下，返回负数错误码。
	ret = security_binder_set_context_mgr(proc->cred);
	if (ret < 0)
		goto out;
        // binder_context_mgr_uid在init_binder_device时初始化为INVALID_UID
        // 如果之前已经设置过uid（比如context manager挂了又重启，这个逻辑允许同一个uid重新注册），就必须跟当前uid一致，否则返回-EPERM（权限不允许）
        // 这是防止不同uid的进程冒充或抢占context manager角色的关键防线，双重保险（SELinux + uid校验）。
	if (uid_valid(context->binder_context_mgr_uid)) {
		if (!uid_eq(context->binder_context_mgr_uid, curr_euid)) {
			pr_err("BINDER_SET_CONTEXT_MGR bad uid %d != %d\n", from_kuid(&init_user_ns, curr_euid), from_kuid(&init_user_ns, context->binder_context_mgr_uid));
			ret = -EPERM;
			goto out;
		}
	} else {
                // 如果还没设置过, 把当前uid记下来，作为"这个context允许的管理者uid"
		context->binder_context_mgr_uid = curr_euid;
	}
        // 调用binder_new_node分配并初始化一个新的binder_node（binder节点对象）
        // fbo如果非NULL（走的是BINDER_SET_CONTEXT_MGR_EXT路径）会带上FLAT_BINDER_FLAG_TXN_SECURITY_CTX之类的标志信息；如果是NULL（老接口），用默认值创建。分配失败返回-ENOMEM。
	new_node = binder_new_node(proc, fbo);
	if (!new_node) {
		ret = -ENOMEM;
		goto out;
	}
	binder_node_lock(new_node);
        // 给这个新节点的强/弱引用计数都手动+1并标记has_strong_ref/has_weak_ref为1
        // 正常的binder节点引用计数是由其他进程持有引用时才增加、没人引用时自动被销毁的；
        // 这里人为地保持它至少有一个引用，确保这个作为context manager的节点永远不会因为"没人引用"而被自动释放——因为它是全局handle 0，必须在整个系统运行期间一直存在。
	new_node->local_weak_refs++;
	new_node->local_strong_refs++;
	new_node->has_strong_ref = 1;
	new_node->has_weak_ref = 1;
        // 赋给binder_proc的context，这就是全局状态被正式建立的时刻
	context->binder_context_mgr_node = new_node;
	binder_node_unlock(new_node);
        // binder_put_node内部只有一行binder_dec_node_tmpref(node)
        // 用于释放的是binder_new_node内部创建时附带的一份临时引用（函数内部逻辑通常创建时会带一份"创建者"引用，这里显式释放掉，避免引用计数虚高）
	binder_put_node(new_node);
out:
	mutex_unlock(&context->context_mgr_node_lock);
	return ret;
}
```

重点看下binder_new_node

```c
static struct binder_node *binder_new_node(struct binder_proc *proc,
					   struct flat_binder_object *fp)
{
	struct binder_node *node;
        // 锁外kzalloc分配内存
	struct binder_node *new_node = kzalloc(sizeof(*node), GFP_KERNEL);

	if (!new_node)
		return NULL;
	binder_inner_proc_lock(proc);
        // 真正的查找/插入
	node = binder_init_node_ilocked(proc, new_node, fp);
	binder_inner_proc_unlock(proc);
	if (node != new_node)
		/*
		 * The node was already added by another thread
		 */
		kfree(new_node);

	return node;
}
```

binder_init_node_ilocked

```c
static struct binder_node *binder_init_node_ilocked(
						struct binder_proc *proc,
						struct binder_node *new_node,
						struct flat_binder_object *fp)
{
	struct rb_node **p = &proc->nodes.rb_node;
	struct rb_node *parent = NULL;
	struct binder_node *node;
        // 先从fp（flat_binder_object）里取出关键字段
        // 每个都做了fp ?判空，这就是为什么binder_ioctl_set_ctx_mgr里fp传NULL（老接口BINDER_SET_CONTEXT_MGR）也能正常工作：ptr/cookie/flags全部退化成0
        // ptr是用户空间那个binder对象的地址（用来在内核里标识"这是哪个对象"），cookie是用户附带的不透明数据。
	binder_uintptr_t ptr = fp ? fp->binder : 0;
	binder_uintptr_t cookie = fp ? fp->cookie : 0;
	__u32 flags = fp ? fp->flags : 0;
	s8 priority;

	assert_spin_locked(&proc->inner_lock);
        // 按ptr这个地址值在proc->nodes红黑树里查找
        // binder的设计是：同一个用户空间binder对象（相同地址）只应该对应一个内核binder_node
        // 如果发现树里已经有相同ptr的节点，直接给它临时引用计数+1并返回已存在的节点，不创建新的。
	while (*p) {

		parent = *p;
		node = rb_entry(parent, struct binder_node, rb_node);

		if (ptr < node->ptr)
			p = &(*p)->rb_left;
		else if (ptr > node->ptr)
			p = &(*p)->rb_right;
		else {
			/*
			 * A matching node is already in
			 * the rb tree. Abandon the init
			 * and return it.
			 */
			binder_inc_node_tmpref_ilocked(node);
			return node;
		}
	}
        // 把没找到匹配节点时，用传入的new_node正式初始化：
        // 分配全局唯一的debug_id（调试用，dumpsys能看到）、记录属于哪个proc、记住ptr/cookie（供后续查找和跨进程通信时反查），并插入红黑树。
	node = new_node;
	binder_stats_created(BINDER_STAT_NODE);
	node->tmp_refs++;
	rb_link_node(&node->rb_node, parent, p);
	rb_insert_color(&node->rb_node, &proc->nodes);
	node->debug_id = atomic_inc_return(&binder_last_id);
	node->proc = proc;
	node->ptr = ptr;
	node->cookie = cookie;
	node->work.type = BINDER_WORK_NODE;
        // 从flags这个位掩码里解析出各种标志位
        // 这些正是之前在binder.h里看到的FLAT_BINDER_FLAG_*常量：调度策略/优先级、是否接受文件描述符、是否继承实时调度策略、是否要求安全上下文
        // becomeContextManager那次调用要设置FLAT_BINDER_FLAG_TXN_SECURITY_CTX，最终落在这个新创建的context manager节点的txn_security_ctx字段上。
	priority = flags & FLAT_BINDER_FLAG_PRIORITY_MASK;
	node->sched_policy = (flags & FLAT_BINDER_FLAG_SCHED_POLICY_MASK) >>
		FLAT_BINDER_FLAG_SCHED_POLICY_SHIFT;
	node->min_priority = to_kernel_prio(node->sched_policy, priority);
	node->accept_fds = !!(flags & FLAT_BINDER_FLAG_ACCEPTS_FDS);
	node->inherit_rt = !!(flags & FLAT_BINDER_FLAG_INHERIT_RT);
	node->txn_security_ctx = !!(flags & FLAT_BINDER_FLAG_TXN_SECURITY_CTX);
        // 初始化节点自己的锁（保护节点级别的状态，比inner_lock更细粒度）和两个链表
        //（work.entry用于把这个节点挂到某个待处理工作队列上；async_todo是异步（oneway）事务的等待队列）。
	spin_lock_init(&node->lock);
	INIT_LIST_HEAD(&node->work.entry);
	INIT_LIST_HEAD(&node->async_todo);
	binder_debug(BINDER_DEBUG_INTERNAL_REFS,
		     "%d:%d node %d u%016llx c%016llx created\n",
		     proc->pid, current->pid, node->debug_id,
		     (u64)node->ptr, (u64)node->cookie);

	return node;
}
```

#### BINDER_WRITE_READ

用户态

<p><code>talkWithDriver()</code><span style="color: rgb(32, 32, 32);">是</span><code>IPCThreadState</code><span style="color: rgb(32, 32, 32);">跟binder驱动打交道的</span><strong>唯一入口</strong><span style="color: rgb(32, 32, 32);">——所有跨进程调用最终都会走到这里，用一次</span><code>BINDER_WRITE_READ</code><span style="color: rgb(32, 32, 32);">ioctl把"要发的命令"和"想收的命令"一起打包发给驱动。</span></p>

```cpp
// frameworks/native/libs/binder/IPCThreadState.cpp
status_t IPCThreadState::talkWithDriver(bool doReceive)
{
    // mDriverFD就是ProcessState进程级单例fd
    if (mProcess->mDriverFD < 0) {
        return -EBADF;
    }

    binder_write_read bwr;

    // mOut/mIn是IPCThreadState内部两个Parcel缓冲区，分别存"待发给驱动的命令流"和"从驱动收到的命令流"。
    // needRead表示mIn这块输入缓冲区是否已经读完（dataPosition() >= dataSize()意味着之前收到的数据已经被上层逻辑消费光了，没剩余可读的了）
    const bool needRead = mIn.dataPosition() >= mIn.dataSize();

    // We don't want to write anything if we are still reading
    // from data left in the input buffer and the caller
    // has requested to read the next data.
    // 决定这次要不要带上写数据——doReceive是调用者传入的参数（表示"这次调用是否希望同时读取"）
    // 如果不需要读（!doReceive），或者需要读但输入缓冲已经空了（needRead），那就把mOut里攒的所有待发命令一起打包发出去；
    // 否则（doReceive为true且mIn里还有数据没读完）就不发送，只想读，这次先设outAvail=0
    const size_t outAvail = (!doReceive || needRead) ? mOut.dataSize() : 0;

    // 填的是mOut（把要发的命令数据地址和长度告诉驱动）
    bwr.write_size = outAvail;
    bwr.write_buffer = (uintptr_t)mOut.data();

    // This is what we'll read.
    // 只有doReceive && needRead同时满足才填mIn的缓冲区地址和"容量"（dataCapacity()，即整块buffer的大小，不是当前已用大小），否则置0表示这次不读
    if (doReceive && needRead) {
        bwr.read_size = mIn.dataCapacity();
        bwr.read_buffer = (uintptr_t)mIn.data();
    } else {
        bwr.read_size = 0;
        bwr.read_buffer = 0;
    }
	...
    // Return immediately if there is nothing to do.
    if ((bwr.write_size == 0) && (bwr.read_size == 0)) return NO_ERROR;

    // write_consumed/read_consumed先清零，驱动处理完会把实际消费/填充的字节数写回这两个字段。
    bwr.write_consumed = 0;
    bwr.read_consumed = 0;
    // do...while (err == -EINTR)是处理系统调用被信号打断的标准写法
    // EINTR表示ioctl执行途中被信号中断了，这种情况应该原样重试而不是当成真正的错误，因为数据可能还没真正传输，重试才能保证语义正确。
    status_t err;
    do {
        ...
#if defined(__ANDROID__)
        if (ioctl(mProcess->mDriverFD, BINDER_WRITE_READ, &bwr) >= 0)
            err = NO_ERROR;
        else
            err = -errno;
#else
        err = INVALID_OPERATION;
#endif
        if (mProcess->mDriverFD < 0) {
            err = -EBADF;
        }
        ...
    } while (err == -EINTR);
	...

    if (err >= NO_ERROR) {
        if (bwr.write_consumed > 0) {
            // 如果驱动消费了数据（write_consumed > 0），正常情况下驱动应该把整个写缓冲全部消费完（write_consumed == mOut.dataSize()）
            // 如果只消费了一部分，说明驱动出了异常情况，直接LOG_ALWAYS_FATAL崩溃退出
            if (bwr.write_consumed < mOut.dataSize())
                LOG_ALWAYS_FATAL("Driver did not consume write buffer. err: %s consumed: %zu of %zu", statusToString(err).c_str(), (size_t)bwr.write_consumed, mOut.dataSize());
            else {
                mOut.setDataSize(0);
                processPostWriteDerefs();
            }
        }
        // 如果驱动填了数据回来（read_consumed > 0），把mIn的数据大小设成驱动实际填充的字节数，并把读位置重置到0
        if (bwr.read_consumed > 0) {
            mIn.setDataSize(bwr.read_consumed);
            mIn.setDataPosition(0);
        }
        ...
        return NO_ERROR;
    }
	...
    return err;
}
```

内核态

```c
	case BINDER_WRITE_READ:
		ret = binder_ioctl_write_read(filp, cmd, arg, thread);
		if (ret)
			goto err;
		break;
```

binder_ioctl_write_read

```c
// proc是调用者进程结构，thread是外层binder_ioctl已经通过binder_get_thread拿到的当前线程结构
static int binder_ioctl_write_read(struct file *filp,
				unsigned int cmd, unsigned long arg,
				struct binder_thread *thread)
{
	int ret = 0;
	struct binder_proc *proc = filp->private_data;
	unsigned int size = _IOC_SIZE(cmd);
	void __user *ubuf = (void __user *)arg;
        // bwr是内核栈上的binder_write_read结构体
	struct binder_write_read bwr;
        // 大小校验
	if (size != sizeof(struct binder_write_read)) {
		ret = -EINVAL;
		goto out;
	}
        // 拷贝用户数据
	if (copy_from_user(&bwr, ubuf, sizeof(bwr))) {
		ret = -EFAULT;
		goto out;
	}
	...
        // 处理写
	if (bwr.write_size > 0) {
                // binder_thread_write是真正解析mOut那块用户内存里一条条BC_*命令（比如BC_TRANSACTION、BC_FREE_BUFFER、BC_REGISTER_LOOPER等）并执行的函数
                // 把消耗掉的字节数写回bwr.write_consumed
		ret = binder_thread_write(proc, thread, bwr.write_buffer, bwr.write_size, &bwr.write_consumed);
		trace_binder_write_done(ret);
		if (ret < 0) {
			bwr.read_consumed = 0;
			if (copy_to_user(ubuf, &bwr, sizeof(bwr)))
				ret = -EFAULT;
			goto out;
		}
	}
        // 处理读
	if (bwr.read_size > 0) {
                // binder_thread_read是核心的阻塞等待逻辑
                // 如果当前线程没有待处理的工作（thread->todo和proc->todo都是空的），并且没传O_NONBLOCK标志，
                // 这个函数会让当前线程睡眠等待，直到有新的事务/命令到达（比如另一个进程发起了对它的binder调用），才会被唤醒，
                // 把对应的BR_*命令写进用户提供的read_buffer。filp->f_flags & O_NONBLOCK；
                // 如果open时带了非阻塞标志，这里就不会睡眠等待，没数据立刻返回。
		ret = binder_thread_read(proc, thread, bwr.read_buffer,
					 bwr.read_size,
					 &bwr.read_consumed,
					 filp->f_flags & O_NONBLOCK);
		trace_binder_read_done(ret);
		binder_inner_proc_lock(proc);
                // 读完之后检查proc->todo是否还有剩余待处理工作（比如驱动这次只取走了一部分，或者读的过程中又有新任务加入）
                // 如果有就唤醒进程（binder_wakeup_proc_ilocked），确保这批工作不会被遗漏处理
                // 这对应多线程场景：这个进程可能有好几个binder线程在阻塞等待，唤醒机制要保证任务不会卡在没人处理的状态。
		if (!binder_worklist_empty_ilocked(&proc->todo))
			binder_wakeup_proc_ilocked(proc);
		binder_inner_proc_unlock(proc);
		trace_android_vh_binder_read_done(proc, thread);
		if (ret < 0) {
			if (copy_to_user(ubuf, &bwr, sizeof(bwr)))
				ret = -EFAULT;
			goto out;
		}
	}
	...
	if (copy_to_user(ubuf, &bwr, sizeof(bwr))) {
		ret = -EFAULT;
		goto out;
	}
out:
	return ret;
}
```

处理写

```c
// binder_buffer/size就是外层传进来的bwr.write_buffer/bwr.write_size
// 注意这里*consumed是入参（不是从0开始！），意味着如果这不是第一次调用（比如上次因为某种原因只处理了一部分），可以从上次断点继续
static int binder_thread_write(struct binder_proc *proc,
			struct binder_thread *thread,
			binder_uintptr_t binder_buffer, size_t size,
			binder_size_t *consumed)
{
	uint32_t cmd;
	struct binder_context *context = proc->context;
        // binder_buffer的类型是binder_uintptr_t，这是binder协议里专门定义的一个类型（在binder.h里），本质上是个固定宽度的无符号整数（64位系统上是__u64）
        // uintptr_t是标准C里定义的、保证能容纳一个指针的无符号整数类型。
        // 最后转成void __user * 这是内核里标记"这是一个指向用户空间内存的指针"的标注类型（__user是sparse工具的地址空间标注，运行时不影响行为)
        // 转成void *（不是具体类型的指针）是因为这块内存后面会被当成"原始字节流"来解析
        // 循环里一条条读出uint32_t cmd、再根据命令类型读不同大小的结构体，指针的实际步进是手动用ptr += sizeof(xxx)控制的
	void __user *buffer = (void __user *)(uintptr_t)binder_buffer;
	void __user *ptr = buffer + *consumed;
	void __user *end = buffer + size;

	while (ptr < end && thread->return_error.cmd == BR_OK) {
		int ret;
                // get_user(cmd, (uint32_t __user *)ptr)是内核提供的安全读取用户空间单个标量值的标准接口，专门用来替代直接对用户指针解引用（*ptr）
                // 第一个参数cmd：内核栈上的局部变量，读到的值会存进这里
                // 第二个参数(uint32_t __user *)ptr：把void __user *强转成uint32_t __user *，告诉get_user要读4个字节并解释成uint32_t
		if (get_user(cmd, (uint32_t __user *)ptr))
			return -EFAULT;
                // 把读指针前移 4 字节，跳过刚读的命令码，指向命令后面的参数区。这是典型的"读长度已知的字段、然后手动前移指针"模式
		ptr += sizeof(uint32_t);
		trace_binder_command(cmd);
                // 命令统计（debugfs统计用，非功能性代码）
                // 防止 cmd 是非法/伪造的命令号时数组越界。binder_stats.bc 是固定大小数组（对应 BC_* 命令的种类数）
                // 三个 atomic_inc 分别在三个层级累加同一个命令的调用计数：
                // binder_stats.bc[...]：全局统计，所有进程共享
                // proc->stats.bc[...]：当前 binder 进程（struct binder_proc）级别统计
                // thread->stats.bc[...]：当前 binder 线程（struct binder_thread）级别统计
		if (_IOC_NR(cmd) < ARRAY_SIZE(binder_stats.bc)) {
			atomic_inc(&binder_stats.bc[_IOC_NR(cmd)]);
			atomic_inc(&proc->stats.bc[_IOC_NR(cmd)]);
			atomic_inc(&thread->stats.bc[_IOC_NR(cmd)]);
		}
		switch (cmd) {
                ...
                case BC_TRANSACTION:
		case BC_REPLY: {
			struct binder_transaction_data tr;
                        // 把用户态命令缓冲区里紧跟在命令码后面的 `binder_transaction_data` 整块结构体拷贝进内核栈
			if (copy_from_user(&tr, ptr, sizeof(tr)))
				return -EFAULT;
                        // 指针前移过整个结构体的大小，跳到下一条命令的起始位置
			ptr += sizeof(tr);
			binder_transaction(proc, thread, &tr,
					   cmd == BC_REPLY, 0);
			break;
                ...
		}
                ...
	}
	return 0;
}
```

binder_transaction

```c
```