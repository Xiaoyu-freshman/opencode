# Orchestrator Mode Design

Status: 2026-05-28.

## 概述

本文档论证 OpenCode 的高级工作模式——Orchestrator Mode（编排模式）。该模式实现用户"甩手掌柜"的工作方式：用户只与总体线讨论，总体线自动协调实施总线执行任务。

## 背景与动机

### 用户当前工作模式

```text
用户 → 总体线（讨论、设计） → 生成实施 prompt → 用户复制 → 实施总线（执行） → 生成汇报 → 用户复制 → 总体线（分析） → 循环
```

**问题**：
- 用户需要手动复制粘贴 prompt 和汇报
- 总体线和实施总线是分离的，无法自动通信
- 每次循环都需要用户介入

### 理想工作模式

```text
用户 → 总体线（讨论、设计） → 自动创建实施总线 → 自动传递 prompt → 自动接收汇报 → 自动分析 → 向用户汇报 → 循环
```

**优势**：
- 用户只与总体线交互
- 总体线自动协调实施总线
- 无需手动复制粘贴
- 全自动化流程

## 架构设计

### 三层架构

```text
┌─────────────────────────────────────────────────────────────┐
│                         用户                                 │
│                    只与总体线讨论                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      总体线 (Orchestrator)                   │
│                                                             │
│  职责：                                                      │
│  • 与用户讨论项目方向和架构设计                                │
│  • 分析需求，设计解决方案                                     │
│  • 分解任务为可并行执行的子任务                                │
│  • 自动创建实施总线会话                                       │
│  • 自动生成完整实施 prompt                                    │
│  • 自动传递 prompt 给实施总线                                 │
│  • 自动接收实施总线的汇报                                     │
│  • 分析汇报结果                                              │
│  • 向用户汇报最终结果                                         │
│  • 根据结果决定下一步                                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 实施总线 (Implementation Bus)        │    │
│  │                                                     │    │
│  │  职责：                                              │    │
│  │  • 接收完整实施 prompt                               │    │
│  │  • 使用 Bus-Worker 模式执行任务                      │    │
│  │  • 管理 Worktree                                    │    │
│  │  • 调用 Worker 执行具体任务                          │    │
│  │  • 验证 Worker 输出                                  │    │
│  │  • 提交合并                                          │    │
│  │  • 生成完整汇报                                       │    │
│  │  • 返回汇报给总体线                                   │    │
│  │                                                     │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │              Worker (执行者)                 │    │    │
│  │  │                                             │    │    │
│  │  │  • implementation: 读写文件，无 bash         │    │    │
│  │  │  • diagnostic: 只读 + bash                  │    │    │
│  │  │  • full: 完整权限（需批准）                  │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 信息流

```text
1. 用户输入需求
   ↓
2. 总体线分析需求
   ↓
3. 总体线设计架构方案
   ↓
4. 总体线分解并行任务
   ↓
5. 总体线生成实施 prompt
   ↓
6. 总体线自动创建实施总线会话
   ↓
7. 总体线自动传递 prompt
   ↓
8. 实施总线接收 prompt
   ↓
9. 实施总线使用 Bus-Worker 模式执行
   ↓
10. 实施总线生成汇报
    ↓
11. 总体线自动接收汇报
    ↓
12. 总体线分析汇报
    ↓
13. 总体线向用户汇报结果
    ↓
14. 用户决定下一步
    ↓
    循环...
```

## 技术实现方案

### 方案 1：总体线代理 + 会话编排工具

#### 总体线代理配置

```yaml
# .opencode/agent/orchestrator.md
---
mode: primary
description: 总体线代理 - 自动协调实施总线
permission:
  "*": allow
  task: allow
  todowrite: allow
  question: allow
---

你是总体线代理，负责：

1. 与用户讨论项目方向和架构设计
2. 分析需求，设计解决方案
3. 分解任务为可并行执行的子任务
4. 自动创建实施总线会话
5. 自动生成完整实施 prompt
6. 自动传递 prompt 给实施总线
7. 自动接收实施总线的汇报
8. 分析汇报结果
9. 向用户汇报最终结果
10. 根据结果决定下一步

工作流程：
1. 用户描述需求
2. 你分析并设计架构
3. 你生成实施 prompt
4. 你调用 orchestrate 工具创建实施总线
5. 你等待实施总线完成
6. 你接收汇报并分析
7. 你向用户汇报结果
8. 根据用户反馈继续循环
```

#### 会话编排工具

```typescript
// .opencode/tool/orchestrate.ts
import { tool } from "@opencode-ai/plugin/tool"
import { $ } from "bun"

export default tool({
  description: `自动协调实施总线

功能：
- 创建实施总线会话
- 传递完整 prompt
- 等待实施总线完成
- 接收汇报
- 返回分析结果`,
  args: {
    task: tool.schema.string().describe("任务描述"),
    prompt: tool.schema.string().describe("完整实施 prompt"),
    workers: tool.schema.array(tool.schema.string()).optional().describe("需要的 Worker 类型"),
    timeout: tool.schema.number().optional().describe("超时时间（分钟）"),
  },
  async execute(args) {
    const sessionID = await createBusSession(args.task)
    
    const result = await sendPromptToSession(sessionID, args.prompt)
    
    const report = await waitForCompletion(sessionID, args.timeout || 30)
    
    return {
      sessionID,
      report,
      success: report.includes("完成") || report.includes("成功"),
    }
  },
})
```

### 方案 2：异步任务队列

#### 任务队列工具

```typescript
// .opencode/tool/task-queue.ts
import { tool } from "@opencode-ai/plugin/tool"

interface Task {
  id: string
  status: "pending" | "running" | "completed" | "failed"
  prompt: string
  result?: string
  createdAt: Date
  completedAt?: Date
}

const tasks = new Map<string, Task>()

export default tool({
  description: "管理异步任务队列",
  args: {
    action: tool.schema.enum(["submit", "status", "result", "cancel"]),
    taskID: tool.schema.string().optional(),
    prompt: tool.schema.string().optional(),
  },
  async execute(args) {
    switch (args.action) {
      case "submit":
        return await submitTask(args.prompt!)
      case "status":
        return await getTaskStatus(args.taskID!)
      case "result":
        return await getTaskResult(args.taskID!)
      case "cancel":
        return await cancelTask(args.taskID!)
    }
  },
})
```

### 方案 3：事件驱动架构

#### 事件总线

```typescript
// .opencode/tool/event-bus.ts
import { tool } from "@opencode-ai/plugin/tool"

interface Event {
  type: "task.created" | "task.completed" | "task.failed"
  taskID: string
  data: any
  timestamp: Date
}

const listeners = new Map<string, Function[]>()

export function emit(event: Event) {
  const handlers = listeners.get(event.type) || []
  handlers.forEach(handler => handler(event))
}

export function on(type: string, handler: Function) {
  const handlers = listeners.get(type) || []
  handlers.push(handler)
  listeners.set(type, handlers)
}

export default tool({
  description: "事件总线工具",
  args: {
    action: tool.schema.enum(["emit", "on", "off"]),
    type: tool.schema.string().optional(),
    event: tool.schema.any().optional(),
  },
  async execute(args) {
    switch (args.action) {
      case "emit":
        emit(args.event)
        return "事件已发送"
      case "on":
        on(args.type!, () => {})
        return "监听器已注册"
      case "off":
        return "监听器已移除"
    }
  },
})
```

## 实现路径

### 阶段 1：总体线代理（基础）

**目标**：创建总体线代理，实现基本的任务分解和 prompt 生成

**任务**：
1. 创建 `.opencode/agent/orchestrator.md` 配置
2. 编写总体线代理的 prompt
3. 测试任务分解和 prompt 生成

**验收标准**：
- [ ] 总体线代理可正常加载
- [ ] 能够分析需求并设计架构
- [ ] 能够生成完整的实施 prompt

### 阶段 2：会话编排工具（核心）

**目标**：实现自动化的会话创建和 prompt 传递

**任务**：
1. 实现 `.opencode/tool/orchestrate.ts`
2. 实现会话创建和 prompt 传递
3. 实现结果接收和汇报

**验收标准**：
- [ ] 能够自动创建实施总线会话
- [ ] 能够自动传递 prompt
- [ ] 能够自动接收汇报

### 阶段 3：自动化流程（增强）

**目标**：实现全自动化的 "用户 → 总体线 → 实施总线 → 总体线 → 用户" 流程

**任务**：
1. 实现异步任务队列
2. 实现事件驱动的通知机制
3. 实现自动化的结果分析和汇报

**验收标准**：
- [ ] 用户只需与总体线交互
- [ ] 总体线自动协调实施总线
- [ ] 无需手动复制粘贴

### 阶段 4：优化和完善（完善）

**目标**：优化用户体验，完善错误处理和监控

**任务**：
1. 添加超时和重试机制
2. 添加进度监控和通知
3. 添加错误处理和恢复

**验收标准**：
- [ ] 任务超时有明确提示
- [ ] 执行进度可实时查看
- [ ] 错误能够自动恢复

## 与当前 Bus-Worker 模式的关系

### 层级关系

```text
Orchestrator Mode（高级模式）
    │
    ├── Orchestrator（总体线）
    │       │
    │       └── Implementation Bus（实施总线）
    │               │
    │               └── Bus-Worker Mode（当前模式）
    │                       │
    │                       ├── Bus（主控）
    │                       │
    │                       └── Worker（执行者）
    │                               ├── implementation
    │                               ├── diagnostic
    │                               └── full
```

### 兼容性

- Orchestrator Mode 是 Bus-Worker Mode 的上层封装
- Bus-Worker Mode 保持不变，继续作为实施总线的内部实现
- Orchestrator Mode 通过调用 Bus-Worker Mode 实现具体执行

## 交互示例

### 用户视角

```text
用户：我想给这个项目添加多语言支持

总体线：好的，我来分析一下这个需求...
[自动创建实施总线]
[自动传递 prompt]
[等待实施总线完成]

总体线：实施总线已完成，结果如下：
- 添加了 i18n 支持框架
- 创建了中英文翻译文件
- 更新了所有组件以支持多语言
- 添加了语言切换功能
- 测试通过

用户：很好，下一步做什么？

总体线：建议：
1. 添加更多语言支持（日语、韩语等）
2. 优化翻译文件管理
3. 添加自动翻译功能

你想先做哪个？
```

### 技术视角

```text
1. 用户输入 → 总体线代理
2. 总体线代理分析需求
3. 总体线代理生成实施 prompt
4. 总体线代理调用 orchestrate 工具
5. orchestrate 工具创建实施总线会话
6. orchestrate 工具传递 prompt
7. 实施总线接收 prompt
8. 实施总线使用 Bus-Worker 模式执行
9. 实施总线生成汇报
10. orchestrate 工具接收汇报
11. 总体线代理分析汇报
12. 总体线代理向用户汇报结果
```

## 风险与挑战

### 技术风险

1. **会话管理复杂性**：多会话协调可能引入复杂性
2. **状态同步问题**：跨会话状态同步可能困难
3. **错误处理**：自动化流程的错误处理更复杂

### 缓解措施

1. **简化会话管理**：使用现有的 task 工具和会话系统
2. **明确状态边界**：每个会话独立管理状态
3. **完善错误处理**：添加超时、重试和恢复机制

### 用户体验风险

1. **透明度降低**：用户可能不清楚执行过程
2. **控制感降低**：用户可能觉得失去控制
3. **调试困难**：出错时难以定位问题

### 缓解措施

1. **增加透明度**：实时显示执行进度
2. **保留控制权**：允许用户干预和取消
3. **完善日志**：详细记录执行过程

## 结论

Orchestrator Mode 是 OpenCode 的高级工作模式，实现用户"甩手掌柜"的工作方式。该模式通过总体线代理自动协调实施总线，无需用户手动复制粘贴。

**核心价值**：
- 用户只与总体线交互
- 全自动化流程
- 提高工作效率
- 降低操作复杂度

**实现建议**：
- 分阶段实现，从基础到高级
- 保持与现有 Bus-Worker 模式的兼容
- 优先实现核心功能，逐步完善增强功能
