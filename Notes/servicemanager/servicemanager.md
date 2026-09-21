# servicemanager

# 一、整体流程

```cpp
// frameworks/native/cmds/servicemanager/main.cpp
int main(int argc, char** argv) {
    // 打开驱动
    sp<ProcessState> ps = ProcessState::initWithDriver(driver);
    ...
    sp<ServiceManager> manager = sp<ServiceManager>::make(std::make_unique<Access>());
    ...
    if (!manager->addService("manager", manager, false /*allowIsolated*/, IServiceManager::DUMP_FLAG_PRIORITY_DEFAULT).isOk()) {
        LOG(ERROR) << "Could not self register servicemanager";
    }
    ...
    IPCThreadState::self()->setTheContextObject(manager);
    // 告诉binder驱动它是ServiceManager
    ps->becomeContextManager();

    sp<Looper> looper = Looper::prepare(false /*allowNonCallbacks*/);
    // 将BinderCallback挂到Looper上
    BinderCallback::setupTo(looper);
    ...
    // 开始loop
    while(true) {
        looper->pollAll(-1);
    }

    // should not be reached
    return EXIT_FAILURE;
}
```

## 1.1 打开驱动

```cpp
// frameworks/native/libs/binder/ProcessState.cpp

sp<ProcessState> ProcessState::init(const char *driver, bool requireDefault)
{
   ...
   gProcess = sp<ProcessState>::make(driver);
   ...
}

ProcessState::ProcessState(const char* driver)
      : mDriverName(String8(driver)),
        mDriverFD(-1),
        mVMStart(MAP_FAILED),
        mThreadCountLock(PTHREAD_MUTEX_INITIALIZER),
        mThreadCountDecrement(PTHREAD_COND_INITIALIZER),
        mExecutingThreadsCount(0),
        mWaitingForThreads(0),
        mMaxThreads(DEFAULT_MAX_BINDER_THREADS),
        mCurrentThreads(0),
        mKernelStartedThreads(0),
        mStarvationStartTimeMs(0),
        mForked(false),
        mThreadPoolStarted(false),
        mThreadPoolSeq(1),
        mCallRestriction(CallRestriction::NONE) {
    base::Result<int> opened = open_driver(driver);

    if (opened.ok()) {
        // mmap the binder, providing a chunk of virtual address space to receive transactions.
        mVMStart = mmap(nullptr, BINDER_VM_SIZE, PROT_READ, MAP_PRIVATE | MAP_NORESERVE,
                        opened.value(), 0);
        ...
    }
    ...
    if (opened.ok()) {
        mDriverFD = opened.value();
    }
}

static base::Result<int> open_driver(const char* driver) {
    int fd = open(driver, O_RDWR | O_CLOEXEC);
    ...
}
```

## 1.2 becomeContextManager

```cpp
// frameworks/native/libs/binder/ProcessState.cpp

bool ProcessState::becomeContextManager()
{
    ...
    flat_binder_object obj {
        .flags = FLAT_BINDER_FLAG_TXN_SECURITY_CTX,
    };
    ...
    // 其中，BINDER_SET_CONTEXT_MGR_EXT是cmd，&obj是参数
    int result = ioctl(mDriverFD, BINDER_SET_CONTEXT_MGR_EXT, &obj);
    ...
    return result == 0;
}
```

<p>obj中除flags的其他字段如cookie靠 C++ 的聚合初始化默认置零了，<code>FLAT_BINDER_FLAG_TXN_SECURITY_CTX</code><span style="color: rgb(32, 32, 32);">是设置在 </span><code>flat_binder_object.flags</code><span style="color: rgb(32, 32, 32);">上的一个标志位，表示"</span>这个 binder 节点（目标对象）要求驱动在每次转发事务给它时，附带上发送方进程的 SELinux 安全上下文（security context）<span style="color: rgb(32, 32, 32);">"</span></p>

```c
// bionic/libc/kernel/uapi/linux/android/binder.h
struct flat_binder_object {
  struct binder_object_header hdr;
  __u32 flags;
  union {
    binder_uintptr_t binder;
    __u32 handle;
  };
  binder_uintptr_t cookie;
};
```

iotcl函数原型

```cpp
// ...是 C/C++ 的**可变参数（variadic arguments）**语法
// 表示这个函数除了 fd和 request两个固定参数外，后面可以接收任意数量、任意类型的额外参数（包括零个）
int ioctl(int fd, int request, ...) 
```

`ioctl`的调用方式可以是：

```cpp
ioctl(fd, SOME_REQUEST);              // 不带额外参数
ioctl(fd, SOME_REQUEST, &value);      // 带一个指针参数
ioctl(fd, SOME_REQUEST, 123);         // 带一个整数参数
```

## 1.3 开始loop

BinderCallback

```cpp
// frameworks/native/cmds/servicemanager/main.cpp
class BinderCallback : public LooperCallback {
public:
    static sp<BinderCallback> setupTo(const sp<Looper>& looper) {
        sp<BinderCallback> cb = sp<BinderCallback>::make();

        int binder_fd = -1;
        // 告诉驱动"这个线程要接收 binder 事务了
        IPCThreadState::self()->setupPolling(&binder_fd);
        ...
        int ret = looper->addFd(binder_fd,
                                Looper::POLL_CALLBACK,
                                Looper::EVENT_INPUT,
                                cb,
                                nullptr /*data*/);
        ...
    }

    int handleEvent(int /* fd */, int /* events */, void* /* data */) override {
        IPCThreadState::self()->handlePolledCommands();
        return 1;  // Continue receiving callbacks.
    }
};
```

handlePolledCommands

```cpp
// frameworks/native/libs/binder/IPCThreadState.cpp
status_t IPCThreadState::handlePolledCommands()
{
    status_t result;
    // 一次 ioctl(BINDER_WRITE_READ)读回来的输入缓冲区（mIn）里可能打包了不止一条命令，所以要用 do...while循环，
    do {
        result = getAndExecuteCommand();
    } while (mIn.dataPosition() < mIn.dataSize());
    // 处理之前累积的、延迟的对象引用释放（弱引用回收之类的收尾工作）。
    processPendingDerefs();
    // 把执行过程中可能产生的待发送命令（比如 reply）通过 ioctl(BINDER_WRITE_READ)刷给驱动。
    flushCommands();
    return result;
}
```

```cpp
// frameworks/native/libs/binder/IPCThreadState.cpp
status_t IPCThreadState::getAndExecuteCommand()
{
    status_t result;
    int32_t cmd;

    result = talkWithDriver();
    if (result >= NO_ERROR) {
        ...
        cmd = mIn.readInt32();
        ...
        result = executeCommand(cmd);
        ...
    }
    return result;
}
```

talkWithDriver

```cpp
// frameworks/native/libs/binder/IPCThreadState.cpp
status_t IPCThreadState::talkWithDriver(bool doReceive)
{
    ...
    // write_buffer（对应mOut）和 read_buffer（对应mIn）都是用户态（调用 ioctl的这个进程）分配、拥有的内存，只是数据流向相反
    // write_buffer是"用户态给驱动看"，read_buffer是"驱动写、用户态看
    binder_write_read bwr;

    // Is the read buffer empty?
    // 输入缓冲区 mIn里的数据是不是已经读完了（游标追上末尾）。如果还有没处理完的数据，就不需要再向驱动要新数据。
    const bool needRead = mIn.dataPosition() >= mIn.dataSize();

    // We don't want to write anything if we are still reading
    // from data left in the input buffer and the caller
    // has requested to read the next data.
    // 决定这次要不要把 mOut里攒的命令发出去。
    // 逻辑是：如果调用者不要求读（!doReceive），或者输入缓冲区已经空了需要读新的（needRead），那就把 mOut里现有的数据全部发出去；
    // 否则（doReceive==true但 mIn里还有数据没读完）这次先不发，避免"还没消化完当前数据就急着发新命令"
    const size_t outAvail = (!doReceive || needRead) ? mOut.dataSize() : 0;

    bwr.write_size = outAvail;
    bwr.write_buffer = (uintptr_t)mOut.data();

    // This is what we'll read.
    // 只有调用者要求读（doReceive）且当前 mIn确实已经空了（needRead）才准备读缓冲区；否则读大小设为 0，表示这次调用不读。
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
    bwr.write_consumed = 0;
    bwr.read_consumed = 0;
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
        ...
    } while (err == -EINTR);
    ...
    if (err >= NO_ERROR) {
        if (bwr.write_consumed > 0) {
            if (bwr.write_consumed < mOut.dataSize())
                LOG_ALWAYS_FATAL("Driver did not consume write buffer. "
                                 "err: %s consumed: %zu of %zu",
                                 statusToString(err).c_str(),
                                 (size_t)bwr.write_consumed,
                                 mOut.dataSize());
            else {
                mOut.setDataSize(0);
                processPostWriteDerefs();
            }
        }
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

executeCommand

```cpp
status_t IPCThreadState::executeCommand(int32_t cmd)
{
    BBinder* obj;
    RefBase::weakref_type* refs;
    status_t result = NO_ERROR;

    switch ((uint32_t)cmd) {
    ...
    // 两者都表示“驱动向当前进程投递一笔 Binder 调用请求”，区别是有没有附带调用方的 SELinux 安全上下文
    // SEC_CTX 就是 Security Context
    case BR_TRANSACTION_SEC_CTX:
    case BR_TRANSACTION:
        {
            binder_transaction_data_secctx tr_secctx;
            binder_transaction_data& tr = tr_secctx.transaction_data;

            if (cmd == (int) BR_TRANSACTION_SEC_CTX) {
                result = mIn.read(&tr_secctx, sizeof(tr_secctx));
            } else {
                result = mIn.read(&tr, sizeof(tr));
                tr_secctx.secctx = 0;
            }
            ...
            Parcel buffer;
            buffer.ipcSetDataReference(
                reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                tr.data_size,
                reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                tr.offsets_size/sizeof(binder_size_t), freeBuffer);

            const void* origServingStackPointer = mServingStackPointer;
            mServingStackPointer = __builtin_frame_address(0);

            const pid_t origPid = mCallingPid;
            const char* origSid = mCallingSid;
            const uid_t origUid = mCallingUid;
            const bool origHasExplicitIdentity = mHasExplicitIdentity;
            const int32_t origStrictModePolicy = mStrictModePolicy;
            const int32_t origTransactionBinderFlags = mLastTransactionBinderFlags;
            const int32_t origWorkSource = mWorkSource;
            const bool origPropagateWorkSet = mPropagateWorkSource;
            // Calling work source will be set by Parcel#enforceInterface. Parcel#enforceInterface
            // is only guaranteed to be called for AIDL-generated stubs so we reset the work source
            // here to never propagate it.
            clearCallingWorkSource();
            clearPropagateWorkSource();

            mCallingPid = tr.sender_pid;
            mCallingSid = reinterpret_cast<const char*>(tr_secctx.secctx);
            mCallingUid = tr.sender_euid;
            mHasExplicitIdentity = false;
            mLastTransactionBinderFlags = tr.flags;

            Parcel reply;
            status_t error;
            ...
            if (tr.target.ptr) {
                // We only have a weak reference on the target object, so we must first try to
                // safely acquire a strong reference before doing anything else with it.
                if (reinterpret_cast<RefBase::weakref_type*>(tr.target.ptr)
                            ->attemptIncStrong(this)) {
                    BBinder* binder = reinterpret_cast<BBinder*>(tr.cookie);
                    error = doTransactBinder(binder, tr.code, buffer, &reply, tr.flags);
                    binder->decStrong(this);
                } else {
                    error = doTransactBinder(nullptr, tr.code, buffer, &reply, tr.flags);
                }
            } else {
                BBinder* binder = the_context_object.get();
                error = doTransactBinder(binder, tr.code, buffer, &reply, tr.flags);
            }

            if ((tr.flags & TF_ONE_WAY) == 0) {
                LOG_ONEWAY("Sending reply to %d!", mCallingPid);
                if (error < NO_ERROR) reply.setError(error);

                // b/238777741: clear buffer before we send the reply.
                // Otherwise, there is a race where the client may
                // receive the reply and send another transaction
                // here and the space used by this transaction won't
                // be freed for the client.
                buffer.setDataSize(0);

                constexpr uint32_t kForwardReplyFlags = TF_CLEAR_BUF;

                // TODO: we may want to abort if there is an error here, or return as 'error'
                // from this function, but the impact needs to be measured
                status_t error2 = sendReply(reply, (tr.flags & kForwardReplyFlags));
                if (error2 != OK) {
                    ALOGE("error in sendReply for synchronous call: %s",
                          statusToString(error2).c_str());
                }
            } else {
                if (error != OK) {
                    std::ostringstream logStream;
                    logStream << "oneway function results for code " << tr.code << " on binder at "
                              << reinterpret_cast<void*>(tr.target.ptr)
                              << " will be dropped but finished with status "
                              << statusToString(error);

                    // ideally we could log this even when error == OK, but it
                    // causes too much logspam because some manually-written
                    // interfaces have clients that call methods which always
                    // write results, sometimes as oneway methods.
                    if (reply.dataSize() != 0) {
                        logStream << " and reply parcel size " << reply.dataSize();
                    }
                    std::string message = logStream.str();
                    ALOGI("%s", message.c_str());
                }
                LOG_ONEWAY("NOT sending reply to %d!", mCallingPid);
            }
            mServingStackPointer = origServingStackPointer;
            mCallingPid = origPid;
            mCallingSid = origSid;
            mCallingUid = origUid;
            mHasExplicitIdentity = origHasExplicitIdentity;
            mStrictModePolicy = origStrictModePolicy;
            mLastTransactionBinderFlags = origTransactionBinderFlags;
            mWorkSource = origWorkSource;
            mPropagateWorkSource = origPropagateWorkSet;
            ...
        }
        break;
    ...
}
    
```