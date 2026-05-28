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

## 交互模式设计

### 核心原则

**用户只与总体线交互，总体线自动协调实施总线，关键决策必须征得用户同意。**

### 分层确认机制

```text
┌─────────────────────────────────────────────────────────────┐
│                     用户交互层级                             │
├─────────────────────────────────────────────────────────────┤
│  层级 1：需求讨论（必须确认）                                │
│  • 用户描述需求                                              │
│  • 总体线分析并提出方案                                       │
│  • 用户确认方案                                              │
│  • 总体线才能开始执行                                         │
├─────────────────────────────────────────────────────────────┤
│  层级 2：任务分解（可选确认）                                │
│  • 总体线分解任务为子任务                                     │
│  • 显示分解结果                                              │
│  • 用户可以修改或确认                                        │
│  • 默认自动确认（如果用户不干预）                             │
├─────────────────────────────────────────────────────────────┤
│  层级 3：执行过程（自动执行）                                │
│  • 实施总线自动执行                                          │
│  • 实时显示进度                                              │
│  • 用户可以随时取消                                          │
│  • 无需逐步确认                                              │
├─────────────────────────────────────────────────────────────┤
│  层级 4：结果汇报（必须确认）                                │
│  • 实施总线完成执行                                          │
│  • 总体线分析结果                                            │
│  • 向用户汇报                                                │
│  • 用户决定下一步                                            │
└─────────────────────────────────────────────────────────────┘
```

### 具体交互流程

#### 流程 1：需求讨论（必须确认）

```text
用户：我想给这个项目添加多语言支持

总体线：好的，我来分析一下这个需求。

方案：
1. 使用 i18n 框架
2. 创建中英文翻译文件
3. 更新所有组件支持多语言
4. 添加语言切换功能

预计任务：
- Worker 1：创建 i18n 配置和翻译文件
- Worker 2：更新组件支持多语言
- Worker 3：添加语言切换 UI

是否确认这个方案？

用户：确认

总体线：好的，开始执行...
```

#### 流程 2：任务分解（可选确认）

```text
总体线：我已经分解了任务：

任务 1：创建 i18n 配置和翻译文件
- Worker: implementation
- 预计时间：5 分钟

任务 2：更新组件支持多语言
- Worker: implementation
- 预计时间：10 分钟

任务 3：添加语言切换 UI
- Worker: implementation
- 预计时间：5 分钟

是否需要修改任务分解？

用户：（不回复，默认确认）

总体线：开始执行任务...
```

#### 流程 3：执行过程（自动执行）

```text
总体线：正在执行...

[进度条] 任务 1/3：创建 i18n 配置和翻译文件
[进度条] 任务 2/3：更新组件支持多语言
[进度条] 任务 3/3：添加语言切换 UI

用户：（可以随时输入"取消"来停止执行）
```

#### 流程 4：结果汇报（必须确认）

```text
总体线：执行完成！

结果：
- ✓ 创建了 i18n 配置
- ✓ 创建了中英文翻译文件
- ✓ 更新了 15 个组件
- ✓ 添加了语言切换 UI
- ✓ 测试通过

下一步建议：
1. 添加更多语言支持
2. 优化翻译文件管理
3. 添加自动翻译功能

你想做什么？

用户：先添加日语支持

总体线：好的，开始分析日语支持的需求...
```

### 确认机制设计

#### 确认类型

```typescript
type ConfirmationType = 
  | "required"    // 必须确认，等待用户回复
  | "optional"    // 可选确认，超时自动确认
  | "auto"        // 自动确认，无需用户干预

interface ConfirmationConfig {
  type: ConfirmationType
  timeout?: number  // 超时时间（秒）
  message: string   // 确认消息
  options?: string[] // 可选选项
}
```

#### 确认层级配置

| 层级 | 确认类型 | 超时 | 说明 |
|------|----------|------|------|
| 需求讨论 | required | 无 | 必须等待用户确认方案 |
| 任务分解 | optional | 30秒 | 超时自动确认 |
| 执行过程 | auto | 无 | 自动执行，用户可取消 |
| 结果汇报 | required | 无 | 必须等待用户决定下一步 |

### 用户控制权

#### 1. 取消执行

```text
用户：取消

总体线：已取消执行。
已完成的任务：
- ✓ 任务 1：创建 i18n 配置
- ✗ 任务 2：已取消
- ✗ 任务 3：已取消

是否保留已完成的部分？

用户：保留

总体线：已保留任务 1 的结果。
```

#### 2. 修改方案

```text
总体线：方案如下：
1. 使用 i18n 框架
2. 创建中英文翻译文件
...

用户：修改方案，使用 react-i18next 而不是 i18next

总体线：好的，已修改方案：
1. 使用 react-i18next 框架
2. 创建中英文翻译文件
...

是否确认？

用户：确认

总体线：开始执行...
```

#### 3. 调整优先级

```text
总体线：任务分解：
1. 创建 i18n 配置
2. 更新组件
3. 添加语言切换 UI

用户：调整优先级，先做任务 3

总体线：好的，已调整优先级：
1. 添加语言切换 UI
2. 创建 i18n 配置
3. 更新组件

开始执行...
```

### 透明度设计

#### 1. 实时进度显示

```text
┌─────────────────────────────────────────────────────────────┐
│ 执行进度                                                    │
├─────────────────────────────────────────────────────────────┤
│ 任务 1/3：创建 i18n 配置和翻译文件                          │
│ ████████████████████████████████████████ 100% 完成          │
├─────────────────────────────────────────────────────────────┤
│ 任务 2/3：更新组件支持多语言                                │
│ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░ 40% 进行中        │
├─────────────────────────────────────────────────────────────┤
│ 任务 3/3：添加语言切换 UI                                   │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0% 等待中         │
├─────────────────────────────────────────────────────────────┤
│ [取消] [暂停] [查看详情]                                    │
└─────────────────────────────────────────────────────────────┘
```

#### 2. 详细日志

```text
[14:30:15] 开始执行任务 1
[14:30:16] 创建 src/i18n/config.ts
[14:30:17] 创建 src/i18n/locales/zh.json
[14:30:18] 创建 src/i18n/locales/en.json
[14:30:19] 任务 1 完成
[14:30:20] 开始执行任务 2
[14:30:21] 更新 src/components/Header.tsx
...
```

### 交互模式总结

| 阶段 | 用户参与 | 确认方式 | 控制权 |
|------|----------|----------|--------|
| 需求讨论 | 必须参与 | 必须确认 | 完全控制 |
| 任务分解 | 可选参与 | 可选确认 | 可修改 |
| 执行过程 | 可选参与 | 自动执行 | 可取消 |
| 结果汇报 | 必须参与 | 必须确认 | 完全控制 |

### 核心原则

1. **关键决策必须确认**：需求和结果需要用户确认
2. **执行过程自动执行**：无需逐步确认，提高效率
3. **保留用户控制权**：随时可以取消、修改、调整
4. **保持透明度**：实时显示进度和日志

## 总体线代理 Prompt 设计

### 角色定义

总体线代理是一个架构师角色，负责：
- 理解用户需求
- 设计技术方案
- 分解并行任务
- 协调实施总线
- 分析执行结果
- 决定下一步行动

**核心定位**：总体线代理不是执行者，而是决策者和协调者。它不直接写代码，而是分析需求、设计方案、分解任务、协调执行。

### Prompt 设计

```markdown
# 总体线代理 (Orchestrator Agent)

## 角色定义

你是总体线代理，负责与用户讨论项目方向、设计架构方案、分解并行任务，并自动协调实施总线执行。

## 核心职责

1. **需求分析**：理解用户需求，识别关键问题
2. **架构设计**：设计技术方案，考虑可扩展性和维护性
3. **任务分解**：将复杂任务分解为可并行执行的子任务
4. **Prompt 生成**：为每个子任务生成详细的实施 prompt
5. **协调执行**：自动创建实施总线会话并传递 prompt
6. **结果分析**：分析实施总线的汇报，评估执行结果
7. **决策反馈**：向用户汇报结果，提出下一步建议

## 工作流程

### 阶段 1：需求讨论（必须确认）

1. 接收用户需求
2. 分析需求的关键点
3. 设计技术方案
4. 分解并行任务
5. 向用户汇报方案
6. 等待用户确认

### 阶段 2：任务分解（可选确认）

1. 根据确认的方案分解任务
2. 为每个任务指定 Worker 类型
3. 生成详细的实施 prompt
4. 显示任务分解结果
5. 等待用户确认或修改

### 阶段 3：协调执行（自动执行）

1. 创建实施总线会话
2. 传递实施 prompt
3. 监控执行进度
4. 接收执行汇报

### 阶段 4：结果汇报（必须确认）

1. 分析执行结果
2. 评估完成质量
3. 向用户汇报结果
4. 提出下一步建议
5. 等待用户决定

## 输出格式

### 方案汇报格式

```text
## 方案分析

### 需求理解
- 核心需求：...
- 关键问题：...
- 约束条件：...

### 技术方案
- 方案名称：...
- 技术选型：...
- 架构设计：...
- 优缺点分析：...

### 任务分解
- 任务 1：...（Worker: implementation）
- 任务 2：...（Worker: diagnostic）
- 任务 3：...（Worker: implementation）

### 预计时间
- 任务 1：5 分钟
- 任务 2：10 分钟
- 任务 3：5 分钟
- 总计：20 分钟

是否确认这个方案？
```

### 任务分解格式

```text
## 任务分解

### 任务 1：[任务名称]
- **Worker 类型**：implementation
- **目标**：...
- **输入**：...
- **输出**：...
- **验收标准**：...

### 任务 2：[任务名称]
- **Worker 类型**：diagnostic
- **目标**：...
- **输入**：...
- **输出**：...
- **验收标准**：...

是否需要修改任务分解？
```

### 结果汇报格式

```text
## 执行结果

### 完成情况
- ✓ 任务 1：完成
- ✓ 任务 2：完成
- ✗ 任务 3：失败（原因：...）

### 质量评估
- 代码质量：...
- 测试覆盖：...
- 文档完整性：...

### 下一步建议
1. ...
2. ...
3. ...

你想做什么？
```

## 交互规则

### 必须确认的情况

1. 需求讨论完成后
2. 结果汇报完成后
3. 方案有重大调整时

### 可选确认的情况

1. 任务分解后（超时 30 秒自动确认）
2. 执行过程中的进度更新

### 自动执行的情况

1. 实施总线执行任务时
2. 接收汇报时

### 用户控制

1. 用户可随时取消执行
2. 用户可修改方案和任务分解
3. 用户可调整优先级

## 与实施总线的交互

### Prompt 生成规则

1. 每个任务生成独立的 prompt
2. Prompt 包含完整的上下文
3. 明确指定 Worker 类型
4. 明确验收标准

### 汇报接收规则

1. 接收实施总线的完整汇报
2. 分析执行结果
3. 评估完成质量
4. 决定下一步行动

## 注意事项

1. **不要直接执行**：总体线代理不直接写代码或执行命令
2. **保持决策权**：关键决策必须由用户确认
3. **保持透明度**：实时显示进度和日志
4. **保留控制权**：用户可随时取消或修改
```

### 设计要点

1. **角色明确**：总体线代理是决策者和协调者，不是执行者
2. **流程清晰**：四个阶段（需求讨论→任务分解→协调执行→结果汇报）
3. **格式规范**：统一的输出格式便于解析和自动化
4. **交互自然**：保持对话的连贯性和自然度
5. **控制权保留**：用户可随时取消、修改、调整

## 会话编排工具实现细节

### 实现策略：分阶段实现

#### 阶段 1：基于 task 工具（优化同步体验）

**核心思路**：复用 OpenCode 现有的 task 工具创建子会话，通过优化提升用户体验。

**同步阻塞的问题分析**：

| 问题 | 影响程度 | 说明 |
|------|----------|------|
| 长时间等待 | 高 | 用户体验差，效率低 |
| 无法取消 | 高 | 用户失去控制权 |
| 超时风险 | 高 | 任务可能失败 |
| 不支持长时间任务 | 高 | 限制使用场景 |

**具体场景**：
- 小型任务（5-10 分钟）：同步阻塞可接受
- 中型任务（10-30 分钟）：体验差，可能超时
- 大型任务（30+ 分钟）：不可接受，无法使用

**阶段 1 优化方案**：

```typescript
// .opencode/tool/orchestrate.ts
import { tool } from "@opencode-ai/plugin/tool"

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
    timeout: tool.schema.number().optional().describe("超时时间（分钟），默认 30"),
  },
  async execute(args) {
    const timeout = (args.timeout || 30) * 60 * 1000  // 转换为毫秒
    const startTime = Date.now()
    
    // 1. 创建实施总线会话
    showProgress("正在创建实施总线会话...")
    const sessionID = await createBusSession(args.task)
    
    // 2. 传递 prompt
    showProgress("正在传递实施 prompt...")
    await sendPromptToSession(sessionID, args.prompt)
    
    // 3. 等待完成（带超时和进度提示）
    showProgress("正在等待实施总线完成...")
    let lastProgress = ""
    
    while (true) {
      // 检查超时
      if (Date.now() - startTime > timeout) {
        return {
          sessionID,
          success: false,
          error: "任务超时，请重试或拆分任务",
          duration: (Date.now() - startTime) / 1000,
        }
      }
      
      // 获取状态
      const status = await getSessionStatus(sessionID)
      
      // 更新进度
      const progress = formatProgress(status)
      if (progress !== lastProgress) {
        showProgress(progress)
        lastProgress = progress
      }
      
      // 检查完成
      if (status === "completed") {
        const report = await getSessionResult(sessionID)
        return {
          sessionID,
          success: true,
          report,
          duration: (Date.now() - startTime) / 1000,
        }
      }
      
      // 检查失败
      if (status === "failed") {
        const error = await getSessionError(sessionID)
        return {
          sessionID,
          success: false,
          error,
          duration: (Date.now() - startTime) / 1000,
        }
      }
      
      // 等待 1 秒
      await sleep(1000)
    }
  },
})

// 辅助函数
function showProgress(message: string) {
  // 显示进度提示
  console.log(`[进度] ${message}`)
}

function formatProgress(status: any): string {
  // 格式化进度信息
  return `状态: ${status.state}, 进度: ${status.progress}%`
}

async function createBusSession(task: string): Promise<string> {
  // 创建实施总线会话
  // 调用 OpenCode 的 session API
  return "session-id"
}

async function sendPromptToSession(sessionID: string, prompt: string): Promise<void> {
  // 传递 prompt 到会话
  // 调用 OpenCode 的 message API
}

async function getSessionStatus(sessionID: string): Promise<string> {
  // 获取会话状态
  return "running"
}

async function getSessionResult(sessionID: string): Promise<string> {
  // 获取会话结果
  return "执行完成"
}

async function getSessionError(sessionID: string): Promise<string> {
  // 获取会话错误
  return "执行失败"
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

**优化点**：
1. **进度提示**：实时显示执行进度
2. **超时处理**：避免无限等待
3. **错误处理**：捕获并返回错误信息
4. **状态查询**：支持查看执行状态

**阶段 1 局限性**：
- 仍然是同步阻塞
- 不支持并行执行
- 不支持暂停恢复

#### 阶段 2：异步任务队列（增强功能）

**核心思路**：实现独立的异步任务队列系统，支持长时间任务和并行执行。

```typescript
// .opencode/tool/task-queue.ts
import { tool } from "@opencode-ai/plugin/tool"

interface Task {
  id: string
  status: "pending" | "running" | "completed" | "failed"
  prompt: string
  result?: string
  error?: string
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

async function submitTask(prompt: string): Promise<{ taskID: string }> {
  const taskID = generateTaskID()
  tasks.set(taskID, {
    id: taskID,
    status: "pending",
    prompt,
    createdAt: new Date(),
  })
  
  // 异步执行任务
  executeTaskInBackground(taskID)
  
  return { taskID }
}

async function getTaskStatus(taskID: string): Promise<Task> {
  const task = tasks.get(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  return task
}

async function getTaskResult(taskID: string): Promise<string> {
  const task = tasks.get(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  if (task.status !== "completed") throw new Error(`任务 ${taskID} 未完成`)
  return task.result!
}

async function cancelTask(taskID: string): Promise<void> {
  const task = tasks.get(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  if (task.status === "completed") throw new Error(`任务 ${taskID} 已完成，无法取消`)
  
  // 取消任务
  task.status = "failed"
  task.error = "用户取消"
  task.completedAt = new Date()
}

async function executeTaskInBackground(taskID: string): Promise<void> {
  const task = tasks.get(taskID)!
  task.status = "running"
  
  try {
    // 执行任务
    const result = await executeTask(task.prompt)
    task.status = "completed"
    task.result = result
    task.completedAt = new Date()
  } catch (error) {
    task.status = "failed"
    task.error = error.message
    task.completedAt = new Date()
  }
}
```

**优点**：
- 支持长时间任务
- 支持并行执行
- 支持取消操作
- 状态可查询

**缺点**：
- 实现复杂
- 需要状态管理
- 需要持久化

#### 阶段 3：事件驱动架构（完整方案）

**核心思路**：基于事件总线实现异步通信，支持松耦合和可扩展性。

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

**优点**：
- 松耦合
- 可扩展
- 支持并发

**缺点**：
- 实现复杂度高
- 调试困难
- 需要事件持久化

### 实现优先级

| 阶段 | 方案 | 优先级 | 说明 |
|------|------|--------|------|
| 1 | 基于 task 工具（优化同步） | 高 | 快速验证概念 |
| 2 | 异步任务队列 | 中 | 增强功能 |
| 3 | 事件驱动架构 | 低 | 完整方案 |

### 接口设计

#### 输入接口

```typescript
interface OrchestrateInput {
  task: string           // 任务描述
  prompt: string         // 完整实施 prompt
  workers?: string[]     // 需要的 Worker 类型
  timeout?: number       // 超时时间（分钟）
}
```

#### 输出接口

```typescript
interface OrchestrateOutput {
  sessionID: string      // 会话 ID
  success: boolean       // 是否成功
  report: string         // 执行汇报
  duration: number       // 执行时长（秒）
  error?: string         // 错误信息
}
```

### 关键实现细节

#### 1. 会话创建

```typescript
async function createBusSession(task: string): Promise<string> {
  // 调用 OpenCode 的 session API 创建新会话
  const session = await sdk.session.create({
    title: `实施总线: ${task}`,
    agent: "bus",
    permission: [...],
  })
  return session.id
}
```

#### 2. Prompt 传递

```typescript
async function sendPromptToSession(sessionID: string, prompt: string): Promise<void> {
  // 调用 OpenCode 的 message API 发送消息
  await sdk.message.create({
    sessionID,
    content: prompt,
    role: "user",
  })
}
```

#### 3. 状态查询

```typescript
async function getSessionStatus(sessionID: string): Promise<string> {
  // 调用 OpenCode 的 session API 获取状态
  const session = await sdk.session.get(sessionID)
  return session.status
}
```

#### 4. 结果获取

```typescript
async function getSessionResult(sessionID: string): Promise<string> {
  // 调用 OpenCode 的 message API 获取最后一条消息
  const messages = await sdk.message.list(sessionID)
  return messages[messages.length - 1].content
}
```

## 异步任务的状态管理

### 状态定义

#### 任务状态类型

```typescript
type TaskStatus = 
  | "pending"    // 等待执行
  | "running"    // 执行中
  | "paused"     // 已暂停
  | "completed"  // 已完成
  | "failed"     // 已失败
  | "cancelled"  // 已取消
```

#### 状态转换图

```text
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
          ┌────────│   running   │────────┐
          │        └──────┬──────┘        │
          │               │               │
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │   paused    │ │  completed  │ │   failed    │
   └──────┬──────┘ └─────────────┘ └─────────────┘
          │
          ▼
   ┌─────────────┐
   │  cancelled  │
   └─────────────┘
```

#### 状态转换规则

| 当前状态 | 可转换状态 | 说明 |
|----------|------------|------|
| pending | running, cancelled | 等待执行或取消 |
| running | paused, completed, failed, cancelled | 执行中可暂停、完成、失败或取消 |
| paused | running, cancelled | 暂停可恢复或取消 |
| completed | - | 终态，不可转换 |
| failed | - | 终态，不可转换 |
| cancelled | - | 终态，不可转换 |

### 实现方案

#### 推荐方案：文件状态持久化

**存储位置**：`~/.config/opencode/tasks/`

**文件格式**：每个任务一个 JSON 文件

```typescript
// .opencode/tool/task-state.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"

interface Task {
  id: string
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled"
  prompt: string
  result?: string
  error?: string
  progress: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

const STATE_DIR = join(process.env.HOME || "~", ".config", "opencode", "tasks")

// 确保目录存在
function ensureDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function getTaskPath(taskID: string): string {
  return join(STATE_DIR, `${taskID}.json`)
}

export function getTask(taskID: string): Task | undefined {
  ensureDir()
  const path = getTaskPath(taskID)
  if (!existsSync(path)) return undefined
  
  const data = readFileSync(path, "utf-8")
  return JSON.parse(data)
}

export function saveTask(task: Task): void {
  ensureDir()
  const path = getTaskPath(task.id)
  writeFileSync(path, JSON.stringify(task, null, 2))
}

export function updateTask(taskID: string, updates: Partial<Task>): void {
  const task = getTask(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  
  Object.assign(task, updates, { updatedAt: new Date().toISOString() })
  
  if (updates.status === "completed" || updates.status === "failed" || updates.status === "cancelled") {
    task.completedAt = new Date().toISOString()
  }
  
  saveTask(task)
}

export function deleteTask(taskID: string): void {
  ensureDir()
  const path = getTaskPath(taskID)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export function listTasks(): Task[] {
  ensureDir()
  const files = readdirSync(STATE_DIR)
  return files
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const data = readFileSync(join(STATE_DIR, f), "utf-8")
      return JSON.parse(data)
    })
}

export function cleanupTasks(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
  const tasks = listTasks()
  const now = Date.now()
  
  for (const task of tasks) {
    const createdAt = new Date(task.createdAt).getTime()
    if (now - createdAt > maxAge) {
      deleteTask(task.id)
    }
  }
}
```

### 状态查询接口

#### 查询单个任务

```typescript
export function getTaskStatus(taskID: string): Task {
  const task = getTask(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  return task
}
```

#### 查询所有任务

```typescript
export function listAllTasks(): Task[] {
  return listTasks()
}
```

#### 查询特定状态的任务

```typescript
export function listTasksByStatus(status: TaskStatus): Task[] {
  return listTasks().filter(t => t.status === status)
}
```

### 状态同步机制

#### 轮询方式

```typescript
export async function waitForTask(
  taskID: string, 
  interval: number = 1000,
  timeout: number = 30 * 60 * 1000
): Promise<Task> {
  const startTime = Date.now()
  
  while (true) {
    const task = getTask(taskID)
    if (!task) throw new Error(`任务 ${taskID} 不存在`)
    
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return task
    }
    
    if (Date.now() - startTime > timeout) {
      throw new Error("等待超时")
    }
    
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}
```

### 清理机制

#### 自动清理过期任务

```typescript
export function cleanupExpiredTasks(maxAgeDays: number = 7): void {
  const tasks = listTasks()
  const now = Date.now()
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000
  
  for (const task of tasks) {
    const createdAt = new Date(task.createdAt).getTime()
    if (now - createdAt > maxAge) {
      deleteTask(task.id)
      console.log(`已清理过期任务: ${task.id}`)
    }
  }
}
```

#### 手动清理

```typescript
export function cleanupAllTasks(): void {
  const tasks = listTasks()
  for (const task of tasks) {
    deleteTask(task.id)
  }
  console.log(`已清理所有任务: ${tasks.length} 个`)
}
```

### 设计要点

1. **文件持久化**：状态保存到文件，支持进程重启
2. **简单实现**：快速验证概念，降低复杂度
3. **易于调试**：JSON 文件可直接查看和编辑
4. **自动清理**：定期清理过期任务，避免磁盘占用

## 错误处理和恢复机制

### 错误类型分类

#### 1. 执行错误

```typescript
type ExecutionError = 
  | "worker_failed"        // Worker 执行失败
  | "timeout"              // 任务超时
  | "permission_denied"    // 权限不足
  | "resource_not_found"   // 资源不存在
  | "conflict"             // 冲突（如文件被修改）
```

#### 2. 系统错误

```typescript
type SystemError = 
  | "session_creation_failed"  // 会话创建失败
  | "message_send_failed"      // 消息发送失败
  | "state_save_failed"        // 状态保存失败
  | "network_error"            // 网络错误
  | "api_error"                // API 错误
```

#### 3. 用户错误

```typescript
type UserError = 
  | "invalid_prompt"       // 无效的 prompt
  | "invalid_task"         // 无效的任务
  | "cancelled"            // 用户取消
```

### 错误处理策略

#### 策略 1：自动重试

```typescript
interface RetryConfig {
  maxRetries: number       // 最大重试次数
  retryDelay: number       // 重试延迟（毫秒）
  backoffMultiplier: number // 退避乘数
  retryableErrors: string[] // 可重试的错误类型
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
  retryableErrors: [
    "timeout",
    "network_error",
    "api_error",
  ],
}

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = defaultRetryConfig
): Promise<T> {
  let lastError: Error | undefined
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      // 检查是否可重试
      if (!isRetryableError(error, config.retryableErrors)) {
        throw error
      }
      
      // 检查是否达到最大重试次数
      if (attempt >= config.maxRetries) {
        throw error
      }
      
      // 计算延迟时间
      const delay = config.retryDelay * Math.pow(config.backoffMultiplier, attempt)
      
      console.log(`执行失败，${delay}ms 后重试 (${attempt + 1}/${config.maxRetries})...`)
      await sleep(delay)
    }
  }
  
  throw lastError
}
```

#### 策略 2：降级处理

```typescript
interface FallbackConfig {
  fallbackAction: "skip" | "manual" | "alternative"
  alternativeFn?: () => Promise<any>
  notifyUser: boolean
}

async function executeWithFallback<T>(
  fn: () => Promise<T>,
  fallback: FallbackConfig
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    console.error("执行失败:", error)
    
    switch (fallback.fallbackAction) {
      case "skip":
        console.log("跳过失败的任务")
        return undefined
        
      case "manual":
        if (fallback.notifyUser) {
          notifyUser("任务失败，请手动处理", error)
        }
        return undefined
        
      case "alternative":
        if (fallback.alternativeFn) {
          console.log("执行替代方案...")
          return await fallback.alternativeFn()
        }
        return undefined
    }
  }
}
```

#### 策略 3：优雅降级

```typescript
interface GracefulDegradationConfig {
  partialSuccess: boolean  // 是否允许部分成功
  continueOnError: boolean // 出错时是否继续
  collectErrors: boolean   // 是否收集所有错误
}

async function executeWithGracefulDegradation<T>(
  tasks: (() => Promise<T>)[],
  config: GracefulDegradationConfig
): Promise<{ results: T[]; errors: Error[] }> {
  const results: T[] = []
  const errors: Error[] = []
  
  for (const task of tasks) {
    try {
      const result = await task()
      results.push(result)
    } catch (error) {
      errors.push(error as Error)
      
      if (!config.continueOnError) {
        break
      }
    }
  }
  
  if (config.partialSuccess && results.length > 0) {
    return { results, errors }
  }
  
  if (errors.length > 0) {
    throw errors[0]
  }
  
  return { results, errors }
}
```

### 恢复机制

#### 1. 任务恢复

```typescript
interface RecoveryConfig {
  autoRecover: boolean     // 是否自动恢复
  recoverableStatuses: string[] // 可恢复的状态
  recoveryAction: "retry" | "resume" | "restart"
}

async function recoverTask(taskID: string, config: RecoveryConfig): Promise<void> {
  const task = getTask(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  
  // 检查是否可恢复
  if (!config.recoverableStatuses.includes(task.status)) {
    throw new Error(`任务 ${taskID} 状态为 ${task.status}，不可恢复`)
  }
  
  switch (config.recoveryAction) {
    case "retry":
      // 重试任务
      await retryTask(taskID)
      break
      
    case "resume":
      // 恢复任务
      await resumeTask(taskID)
      break
      
    case "restart":
      // 重启任务
      await restartTask(taskID)
      break
  }
}

async function retryTask(taskID: string): Promise<void> {
  const task = getTask(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  
  // 重置状态
  updateTask(taskID, { 
    status: "pending", 
    error: undefined,
    progress: 0 
  })
  
  // 重新执行
  await executeTask(taskID)
}

async function resumeTask(taskID: string): Promise<void> {
  const task = getTask(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  
  // 从暂停点恢复
  updateTask(taskID, { status: "running" })
  
  // 继续执行
  await continueTask(taskID, task.progress)
}

async function restartTask(taskID: string): Promise<void> {
  const task = getTask(taskID)
  if (!task) throw new Error(`任务 ${taskID} 不存在`)
  
  // 重置状态
  updateTask(taskID, { 
    status: "pending", 
    error: undefined,
    result: undefined,
    progress: 0 
  })
  
  // 重新执行
  await executeTask(taskID)
}
```

#### 2. 会话恢复

```typescript
async function recoverSession(sessionID: string): Promise<void> {
  try {
    // 检查会话状态
    const status = await getSessionStatus(sessionID)
    
    if (status === "failed") {
      // 会话失败，重新创建
      await recreateSession(sessionID)
    } else if (status === "stuck") {
      // 会话卡住，重启
      await restartSession(sessionID)
    }
  } catch (error) {
    console.error("会话恢复失败:", error)
    throw error
  }
}
```

#### 3. 数据一致性保证

```typescript
interface ConsistencyConfig {
  atomicOperations: boolean  // 是否原子操作
  rollbackOnError: boolean   // 出错时是否回滚
  checkpointInterval: number // 检查点间隔（毫秒）
}

async function executeWithConsistency<T>(
  fn: () => Promise<T>,
  config: ConsistencyConfig
): Promise<T> {
  // 创建检查点
  const checkpoint = await createCheckpoint()
  
  try {
    // 执行操作
    const result = await fn()
    
    // 提交检查点
    await commitCheckpoint(checkpoint)
    
    return result
  } catch (error) {
    // 回滚到检查点
    if (config.rollbackOnError) {
      await rollbackToCheckpoint(checkpoint)
    }
    
    throw error
  }
}
```

### 错误通知

#### 通知方式

```typescript
type NotificationType = 
  | "toast"      // 气泡通知
  | "message"    // 消息通知
  | "email"      // 邮件通知
  | "webhook"    // Webhook 通知

interface NotificationConfig {
  type: NotificationType
  onSuccess: boolean  // 成功时是否通知
  onError: boolean    // 失败时是否通知
  onProgress: boolean // 进度更新时是否通知
}

function notifyUser(
  message: string, 
  error?: Error, 
  config: NotificationConfig = { type: "toast", onSuccess: false, onError: true, onProgress: false }
): void {
  switch (config.type) {
    case "toast":
      showToast({ 
        variant: error ? "error" : "success", 
        title: message,
        description: error?.message 
      })
      break
      
    case "message":
      // 发送消息到当前会话
      sendMessage(message)
      break
      
    case "email":
      // 发送邮件
      sendEmail(message, error)
      break
      
    case "webhook":
      // 发送 Webhook
      sendWebhook(message, error)
      break
  }
}
```

### 完整的错误处理流程

```typescript
async function executeWithErrorHandling<T>(
  fn: () => Promise<T>,
  options: {
    retry?: RetryConfig
    fallback?: FallbackConfig
    degradation?: GracefulDegradationConfig
    recovery?: RecoveryConfig
    consistency?: ConsistencyConfig
    notification?: NotificationConfig
  } = {}
): Promise<T | undefined> {
  try {
    // 1. 创建检查点
    if (options.consistency) {
      return await executeWithConsistency(fn, options.consistency)
    }
    
    // 2. 执行重试逻辑
    if (options.retry) {
      return await executeWithRetry(fn, options.retry)
    }
    
    // 3. 直接执行
    return await fn()
    
  } catch (error) {
    console.error("执行失败:", error)
    
    // 4. 尝试恢复
    if (options.recovery) {
      try {
        await recoverTask(taskID, options.recovery)
        return undefined
      } catch (recoveryError) {
        console.error("恢复失败:", recoveryError)
      }
    }
    
    // 5. 降级处理
    if (options.fallback) {
      return await executeWithFallback(fn, options.fallback)
    }
    
    // 6. 通知用户
    if (options.notification) {
      notifyUser("任务执行失败", error as Error, options.notification)
    }
    
    throw error
  }
}
```

### 实现优先级

**阶段 1**：实现基础错误处理
1. 自动重试（可重试的错误）
2. 超时处理
3. 错误通知

**阶段 2**：增强恢复机制
1. 任务恢复
2. 会话恢复
3. 数据一致性

**阶段 3**：完善降级策略
1. 优雅降级
2. 替代方案
3. 部分成功

### 设计要点

1. **错误分类**：区分执行错误、系统错误和用户错误
2. **重试策略**：自动重试可重试的错误，避免无限重试
3. **恢复机制**：支持任务恢复、会话恢复和数据一致性
4. **错误通知**：及时通知用户，提供清晰的错误信息
5. **优雅降级**：允许部分成功，继续执行其他任务

## 用户体验优化

### 核心要素

#### 1. 进度显示

**数据结构**：

```typescript
interface ProgressDisplay {
  // 整体进度
  overall: {
    total: number        // 总任务数
    completed: number    // 已完成数
    running: number      // 执行中数
    failed: number       // 失败数
    percentage: number   // 完成百分比
  }
  
  // 当前任务进度
  current: {
    taskName: string     // 任务名称
    status: string       // 任务状态
    progress: number     // 任务进度（0-100）
    startTime: Date      // 开始时间
    estimatedTime: number // 预计剩余时间（秒）
  }
  
  // 历史任务
  history: Array<{
    taskName: string
    status: "completed" | "failed" | "cancelled"
    duration: number     // 执行时长（秒）
    result?: string      // 执行结果
  }>
}
```

**显示方式**：

```text
┌─────────────────────────────────────────────────────────────┐
│ 执行进度                                                    │
├─────────────────────────────────────────────────────────────┤
│ 整体进度：3/5 任务完成 (60%)                                │
│ ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├─────────────────────────────────────────────────────────────┤
│ 当前任务：更新组件支持多语言                                │
│ 状态：执行中                                                │
│ 进度：40%                                                   │
│ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ 预计剩余：3 分钟                                            │
├─────────────────────────────────────────────────────────────┤
│ 历史任务：                                                  │
│ ✓ 创建 i18n 配置 (2 分钟)                                  │
│ ✓ 创建翻译文件 (1 分钟)                                    │
│ ● 更新组件支持多语言 (进行中)                              │
│ ○ 添加语言切换 UI (等待中)                                 │
│ ○ 测试多语言功能 (等待中)                                  │
├─────────────────────────────────────────────────────────────┤
│ [取消] [暂停] [查看详情]                                    │
└─────────────────────────────────────────────────────────────┘
```

#### 2. 日志展示

**数据结构**：

```typescript
interface LogEntry {
  timestamp: Date        // 时间戳
  level: "info" | "warn" | "error" | "debug"  // 日志级别
  source: string         // 来源（orchestrator/bus/worker）
  message: string        // 日志内容
  details?: any          // 详细信息
}

interface LogDisplay {
  entries: LogEntry[]
  filters: {
    level: string[]      // 过滤级别
    source: string[]     // 过滤来源
    timeRange: [Date, Date] // 时间范围
  }
  autoScroll: boolean    // 自动滚动
  maxEntries: number     // 最大条目数
}
```

**显示方式**：

```text
┌─────────────────────────────────────────────────────────────┐
│ 执行日志                                                    │
├─────────────────────────────────────────────────────────────┤
│ [14:30:15] [INFO] [orchestrator] 开始执行任务 1            │
│ [14:30:16] [INFO] [bus] 创建实施总线会话                    │
│ [14:30:17] [INFO] [bus] 传递 prompt                        │
│ [14:30:18] [INFO] [worker] 开始执行：创建 i18n 配置        │
│ [14:30:19] [INFO] [worker] 创建 src/i18n/config.ts         │
│ [14:30:20] [INFO] [worker] 创建 src/i18n/locales/zh.json   │
│ [14:30:21] [INFO] [worker] 创建 src/i18n/locales/en.json   │
│ [14:30:22] [INFO] [worker] 任务 1 完成                      │
│ [14:30:23] [INFO] [orchestrator] 开始执行任务 2            │
│ [14:30:24] [WARN] [worker] 文件已存在，将覆盖              │
│ [14:30:25] [INFO] [worker] 更新 src/components/Header.tsx  │
├─────────────────────────────────────────────────────────────┤
│ [过滤器] [INFO] [WARN] [ERROR] [全部来源]                  │
│ [自动滚动] [清空] [导出]                                    │
└─────────────────────────────────────────────────────────────┘
```

#### 3. 确认界面

**数据结构**：

```typescript
interface ConfirmDialog {
  title: string          // 标题
  message: string        // 消息
  details?: string       // 详细说明
  options: Array<{
    label: string        // 选项标签
    value: string        // 选项值
    description?: string // 选项说明
    variant?: "primary" | "secondary" | "danger"  // 样式
  }>
  timeout?: number       // 超时时间（秒）
  defaultValue?: string  // 默认值
}
```

**显示方式**：

```text
┌─────────────────────────────────────────────────────────────┐
│ 确认方案                                                    │
├─────────────────────────────────────────────────────────────┤
│ 方案分析                                                    │
│                                                             │
│ 需求理解：                                                  │
│ - 核心需求：支持多语言界面                                  │
│ - 关键问题：如何管理翻译文件，如何切换语言                  │
│ - 约束条件：不影响现有功能                                  │
│                                                             │
│ 技术方案：                                                  │
│ - 方案名称：i18n 多语言支持                                 │
│ - 技术选型：react-i18next                                   │
│ - 架构设计：                                                │
│   1. 创建 i18n 配置                                         │
│   2. 创建翻译文件                                           │
│   3. 更新组件支持多语言                                     │
│   4. 添加语言切换 UI                                        │
│                                                             │
│ 任务分解：                                                  │
│ - 任务 1：创建 i18n 配置和翻译文件（Worker: implementation）│
│ - 任务 2：更新组件支持多语言（Worker: implementation）      │
│ - 任务 3：添加语言切换 UI（Worker: implementation）         │
│                                                             │
│ 预计时间：                                                  │
│ - 任务 1：5 分钟                                            │
│ - 任务 2：10 分钟                                           │
│ - 任务 3：5 分钟                                            │
│ - 总计：20 分钟                                             │
├─────────────────────────────────────────────────────────────┤
│ [确认方案] [修改方案] [取消]                                │
└─────────────────────────────────────────────────────────────┘
```

#### 4. 错误提示

**数据结构**：

```typescript
interface ErrorDisplay {
  title: string          // 错误标题
  message: string        // 错误消息
  code?: string          // 错误代码
  details?: string       // 详细说明
  suggestions?: string[] // 建议操作
  actions?: Array<{
    label: string        // 操作标签
    action: string       // 操作类型
    description?: string // 操作说明
  }>
}
```

**显示方式**：

```text
┌─────────────────────────────────────────────────────────────┐
│ 错误：任务执行失败                                          │
├─────────────────────────────────────────────────────────────┤
│ 错误信息：                                                  │
│ Worker 执行失败：无法创建文件 src/i18n/config.ts            │
│                                                             │
│ 错误代码：WORKER_FAILED                                     │
│                                                             │
│ 详细说明：                                                  │
│ 文件系统权限不足，无法写入目标目录。                        │
│                                                             │
│ 建议操作：                                                  │
│ 1. 检查目录权限                                             │
│ 2. 使用管理员权限运行                                       │
│ 3. 选择其他目录                                             │
├─────────────────────────────────────────────────────────────┤
│ [重试] [跳过] [修改方案] [查看详情]                        │
└─────────────────────────────────────────────────────────────┘
```

#### 5. 交互反馈

**数据结构**：

```typescript
interface Feedback {
  type: "success" | "error" | "warning" | "info"  // 反馈类型
  title: string          // 标题
  message: string        // 消息
  duration?: number      // 显示时长（毫秒）
  actions?: Array<{
    label: string        // 操作标签
    action: () => void   // 操作函数
  }>
}
```

**显示方式**：

```text
┌─────────────────────────────────────────────────────────────┐
│ ✓ 方案已确认                                                │
│ 开始执行任务...                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⚠ 任务已取消                                                │
│ 已保留任务 1 的结果                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ✗ 任务执行失败                                              │
│ Worker 执行失败：无法创建文件                               │
│ [重试] [跳过] [查看详情]                                    │
└─────────────────────────────────────────────────────────────┘
```

### 组件实现

#### 1. 进度条组件

```typescript
// .opencode/components/progress-bar.tsx
interface ProgressBarProps {
  value: number          // 当前值
  max: number            // 最大值
  label?: string         // 标签
  showPercentage?: boolean // 显示百分比
  showValue?: boolean    // 显示数值
  variant?: "default" | "success" | "error" | "warning"  // 样式
  animated?: boolean     // 是否动画
}

export function ProgressBar(props: ProgressBarProps) {
  const percentage = Math.round((props.value / props.max) * 100)
  
  return (
    <div class="progress-bar">
      {props.label && <div class="progress-bar-label">{props.label}</div>}
      <div class="progress-bar-track">
        <div 
          class={`progress-bar-fill ${props.variant || 'default'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div class="progress-bar-info">
        {props.showPercentage && <span>{percentage}%</span>}
        {props.showValue && <span>{props.value}/{props.max}</span>}
      </div>
    </div>
  )
}
```

#### 2. 日志组件

```typescript
// .opencode/components/log-viewer.tsx
interface LogViewerProps {
  entries: LogEntry[]
  filters?: {
    level?: string[]
    source?: string[]
  }
  autoScroll?: boolean
  maxEntries?: number
  onClear?: () => void
  onExport?: () => void
}

export function LogViewer(props: LogViewerProps) {
  const filteredEntries = props.entries.filter(entry => {
    if (props.filters?.level && !props.filters.level.includes(entry.level)) {
      return false
    }
    if (props.filters?.source && !props.filters.source.includes(entry.source)) {
      return false
    }
    return true
  })
  
  return (
    <div class="log-viewer">
      <div class="log-viewer-header">
        <span>执行日志</span>
        <div class="log-viewer-actions">
          <button onClick={props.onClear}>清空</button>
          <button onClick={props.onExport}>导出</button>
        </div>
      </div>
      <div class="log-viewer-content">
        {filteredEntries.map(entry => (
          <div class={`log-entry ${entry.level}`}>
            <span class="log-timestamp">{formatTime(entry.timestamp)}</span>
            <span class="log-level">{entry.level.toUpperCase()}</span>
            <span class="log-source">[{entry.source}]</span>
            <span class="log-message">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

#### 3. 确认对话框组件

```typescript
// .opencode/components/confirm-dialog.tsx
interface ConfirmDialogProps {
  title: string
  message: string
  details?: string
  options: Array<{
    label: string
    value: string
    description?: string
    variant?: "primary" | "secondary" | "danger"
  }>
  timeout?: number
  defaultValue?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const [selected, setSelected] = createSignal(props.defaultValue || '')
  const [timeLeft, setTimeLeft] = createSignal(props.timeout || 0)
  
  // 超时处理
  if (props.timeout) {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          props.onConfirm(selected())
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }
  
  return (
    <div class="confirm-dialog">
      <div class="confirm-dialog-header">
        <h3>{props.title}</h3>
      </div>
      <div class="confirm-dialog-content">
        <p>{props.message}</p>
        {props.details && <div class="confirm-dialog-details">{props.details}</div>}
      </div>
      <div class="confirm-dialog-options">
        {props.options.map(option => (
          <button
            class={`confirm-dialog-option ${option.variant || 'secondary'} ${selected() === option.value ? 'selected' : ''}`}
            onClick={() => setSelected(option.value)}
          >
            <span class="option-label">{option.label}</span>
            {option.description && <span class="option-description">{option.description}</span>}
          </button>
        ))}
      </div>
      <div class="confirm-dialog-footer">
        {timeLeft() > 0 && <span class="timeout">超时：{timeLeft()} 秒</span>}
        <button onClick={props.onCancel}>取消</button>
        <button onClick={() => props.onConfirm(selected())}>确认</button>
      </div>
    </div>
  )
}
```

#### 4. 错误提示组件

```typescript
// .opencode/components/error-display.tsx
interface ErrorDisplayProps {
  title: string
  message: string
  code?: string
  details?: string
  suggestions?: string[]
  actions?: Array<{
    label: string
    action: () => void
    description?: string
  }>
}

export function ErrorDisplay(props: ErrorDisplayProps) {
  return (
    <div class="error-display">
      <div class="error-display-header">
        <span class="error-icon">✗</span>
        <h3>{props.title}</h3>
      </div>
      <div class="error-display-content">
        <p class="error-message">{props.message}</p>
        {props.code && <p class="error-code">错误代码：{props.code}</p>}
        {props.details && <div class="error-details">{props.details}</div>}
        {props.suggestions && (
          <div class="error-suggestions">
            <p>建议操作：</p>
            <ul>
              {props.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {props.actions && (
        <div class="error-actions">
          {props.actions.map(action => (
            <button onClick={action.action}>
              {action.label}
              {action.description && <span class="action-description">{action.description}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

### 实现优先级

**阶段 1**：实现基础进度显示
1. 进度条组件
2. 简单日志显示
3. 基础错误提示

**阶段 2**：增强交互反馈
1. 确认对话框
2. 详细日志
3. 操作反馈

**阶段 3**：完善用户体验
1. 实时进度
2. 日志过滤
3. 错误恢复

### 设计要点

1. **实时性**：进度和日志实时更新，用户随时了解执行状态
2. **清晰性**：错误提示清晰明确，提供具体建议
3. **友好性**：确认界面简洁易懂，操作方便
4. **及时性**：交互反馈及时，用户操作有明确响应
5. **可操作性**：提供具体操作按钮，用户可直接处理问题

## 性能和资源管理

### 性能问题分析

#### 1. 多会话并发的资源消耗

**问题**：同时运行多个会话会消耗大量资源

```text
会话 1：创建 i18n 配置
  - 内存：50MB
  - CPU：10%
  - 网络：100KB/s

会话 2：更新组件
  - 内存：80MB
  - CPU：15%
  - 网络：200KB/s

会话 3：添加语言切换 UI
  - 内存：60MB
  - CPU：12%
  - 网络：150KB/s

总计：
  - 内存：190MB
  - CPU：37%
  - 网络：450KB/s
```

#### 2. 长时间任务的内存管理

**问题**：长时间运行的任务会持续占用内存

```text
任务开始：内存 50MB
  ↓
执行 10 分钟：内存 80MB（中间结果）
  ↓
执行 30 分钟：内存 120MB（累积数据）
  ↓
执行 1 小时：内存 200MB（可能溢出）
```

#### 3. 任务队列的存储和清理

**问题**：任务队列会无限增长

```text
提交任务 1：存储 1KB
提交任务 2：存储 2KB
提交任务 3：存储 3KB
...
提交任务 1000：存储 1000KB

总计：500MB（如果不清理）
```

#### 4. 并发控制和限流

**问题**：没有并发控制会导致资源耗尽

```text
无并发控制：
  - 同时启动 10 个任务
  - 每个任务消耗 50MB 内存
  - 总计：500MB 内存
  - 系统崩溃

有并发控制：
  - 最多同时运行 3 个任务
  - 其他任务排队等待
  - 总计：150MB 内存
  - 系统稳定
```

### 资源管理方案

#### 方案 1：并发控制

```typescript
interface ConcurrencyConfig {
  maxConcurrent: number  // 最大并发数
  maxQueued: number      // 最大排队数
  timeout: number        // 任务超时时间（毫秒）
}

class ConcurrencyManager {
  private running = new Map<string, Promise<any>>()
  private queue: Array<{ task: () => Promise<any>; resolve: Function; reject: Function }> = []
  private config: ConcurrencyConfig
  
  constructor(config: ConcurrencyConfig) {
    this.config = config
  }
  
  async execute<T>(taskID: string, task: () => Promise<T>): Promise<T> {
    // 检查是否超过最大并发数
    if (this.running.size >= this.config.maxConcurrent) {
      // 检查是否超过最大排队数
      if (this.queue.length >= this.config.maxQueued) {
        throw new Error("任务队列已满，请稍后重试")
      }
      
      // 排队等待
      return new Promise((resolve, reject) => {
        this.queue.push({ task, resolve, reject })
      })
    }
    
    // 执行任务
    return this.runTask(taskID, task)
  }
  
  private async runTask<T>(taskID: string, task: () => Promise<T>): Promise<T> {
    const promise = task()
    this.running.set(taskID, promise)
    
    try {
      const result = await promise
      return result
    } finally {
      this.running.delete(taskID)
      this.processQueue()
    }
  }
  
  private processQueue() {
    if (this.queue.length > 0 && this.running.size < this.config.maxConcurrent) {
      const { task, resolve, reject } = this.queue.shift()!
      this.runTask(generateTaskID(), task).then(resolve).catch(reject)
    }
  }
  
  getStatus() {
    return {
      running: this.running.size,
      queued: this.queue.length,
      maxConcurrent: this.config.maxConcurrent,
      maxQueued: this.config.maxQueued,
    }
  }
}
```

**使用方式**：

```typescript
const concurrencyManager = new ConcurrencyManager({
  maxConcurrent: 3,      // 最多同时运行 3 个任务
  maxQueued: 10,         // 最多排队 10 个任务
  timeout: 30 * 60 * 1000, // 任务超时 30 分钟
})
```

#### 方案 2：内存管理

```typescript
interface MemoryConfig {
  maxMemoryMB: number       // 最大内存限制（MB）
  warningThreshold: number  // 警告阈值（百分比）
  cleanupInterval: number   // 清理间隔（毫秒）
}

class MemoryManager {
  private config: MemoryConfig
  private cleanupTimer?: NodeJS.Timer
  
  constructor(config: MemoryConfig) {
    this.config = config
    this.startCleanup()
  }
  
  private startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }
  
  private cleanup() {
    const usage = this.getMemoryUsage()
    
    if (usage.percentage > this.config.warningThreshold) {
      console.warn(`内存使用率过高：${usage.percentage}%`)
      this.forceCleanup()
    }
  }
  
  private forceCleanup() {
    // 清理已完成的任务
    this.cleanupCompletedTasks()
    
    // 清理过期的日志
    this.cleanupExpiredLogs()
    
    // 清理临时文件
    this.cleanupTempFiles()
    
    // 触发垃圾回收
    if (global.gc) {
      global.gc()
    }
  }
  
  getMemoryUsage() {
    const used = process.memoryUsage()
    const total = this.config.maxMemoryMB * 1024 * 1024
    
    return {
      heapUsed: used.heapUsed,
      heapTotal: used.heapTotal,
      rss: used.rss,
      external: used.external,
      percentage: Math.round((used.heapUsed / total) * 100),
    }
  }
  
  private cleanupCompletedTasks() {
    const tasks = listTasks()
    const completedTasks = tasks.filter(t => 
      t.status === "completed" || t.status === "failed" || t.status === "cancelled"
    )
    
    for (const task of completedTasks) {
      // 保留最近 1 小时的任务
      const completedAt = new Date(task.completedAt!).getTime()
      if (Date.now() - completedAt > 60 * 60 * 1000) {
        deleteTask(task.id)
      }
    }
  }
  
  private cleanupExpiredLogs() {
    // 清理超过 24 小时的日志
    const maxAge = 24 * 60 * 60 * 1000
    cleanupLogs(maxAge)
  }
  
  private cleanupTempFiles() {
    // 清理临时文件
    cleanupTempDir()
  }
  
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
  }
}
```

**使用方式**：

```typescript
const memoryManager = new MemoryManager({
  maxMemoryMB: 512,           // 最大 512MB
  warningThreshold: 80,       // 80% 时警告
  cleanupInterval: 5 * 60 * 1000, // 每 5 分钟清理一次
})
```

#### 方案 3：存储管理

```typescript
interface StorageConfig {
  maxStorageMB: number       // 最大存储限制（MB）
  maxTasks: number           // 最大任务数
  maxTaskAge: number         // 最大任务年龄（毫秒）
  cleanupInterval: number    // 清理间隔（毫秒）
}

class StorageManager {
  private config: StorageConfig
  private cleanupTimer?: NodeJS.Timer
  
  constructor(config: StorageConfig) {
    this.config = config
    this.startCleanup()
  }
  
  private startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }
  
  private cleanup() {
    // 清理过期任务
    this.cleanupExpiredTasks()
    
    // 清理超出限制的任务
    this.cleanupExcessTasks()
    
    // 清理大文件
    this.cleanupLargeFiles()
  }
  
  private cleanupExpiredTasks() {
    const tasks = listTasks()
    const now = Date.now()
    
    for (const task of tasks) {
      const createdAt = new Date(task.createdAt).getTime()
      if (now - createdAt > this.config.maxTaskAge) {
        deleteTask(task.id)
        console.log(`已清理过期任务：${task.id}`)
      }
    }
  }
  
  private cleanupExcessTasks() {
    const tasks = listTasks()
    
    if (tasks.length > this.config.maxTasks) {
      // 按创建时间排序，删除最旧的任务
      const sortedTasks = tasks.sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
      
      const tasksToDelete = sortedTasks.slice(0, tasks.length - this.config.maxTasks)
      
      for (const task of tasksToDelete) {
        deleteTask(task.id)
        console.log(`已清理超出限制的任务：${task.id}`)
      }
    }
  }
  
  private cleanupLargeFiles() {
    // 检查并清理大文件
    const tasks = listTasks()
    
    for (const task of tasks) {
      const taskPath = getTaskPath(task.id)
      const stats = require("fs").statSync(taskPath)
      
      // 如果任务文件超过 1MB，清理结果
      if (stats.size > 1024 * 1024) {
        updateTask(task.id, { result: undefined })
        console.log(`已清理大文件任务：${task.id}`)
      }
    }
  }
  
  getStorageUsage() {
    const tasks = listTasks()
    const totalSize = tasks.reduce((sum, task) => {
      const taskPath = getTaskPath(task.id)
      const stats = require("fs").statSync(taskPath)
      return sum + stats.size
    }, 0)
    
    return {
      taskCount: tasks.length,
      totalSize,
      totalSizeMB: Math.round(totalSize / (1024 * 1024)),
      maxStorageMB: this.config.maxStorageMB,
      percentage: Math.round((totalSize / (this.config.maxStorageMB * 1024 * 1024)) * 100),
    }
  }
  
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
  }
}
```

**使用方式**：

```typescript
const storageManager = new StorageManager({
  maxStorageMB: 100,          // 最大 100MB
  maxTasks: 1000,             // 最大 1000 个任务
  maxTaskAge: 7 * 24 * 60 * 60 * 1000, // 最大 7 天
  cleanupInterval: 60 * 60 * 1000,      // 每小时清理一次
})
```

#### 方案 4：性能监控

```typescript
interface PerformanceMetrics {
  taskCount: number           // 任务总数
  runningTasks: number        // 运行中任务数
  queuedTasks: number         // 排队中任务数
  completedTasks: number      // 完成任务数
  failedTasks: number         // 失败任务数
  averageDuration: number     // 平均执行时长（秒）
  memoryUsage: number         // 内存使用率（%）
  storageUsage: number        // 存储使用率（%）
  cpuUsage: number            // CPU 使用率（%）
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics
  private history: Array<{ timestamp: Date; metrics: PerformanceMetrics }> = []
  private maxHistory = 1000
  
  constructor() {
    this.metrics = this.collectMetrics()
    this.startMonitoring()
  }
  
  private startMonitoring() {
    setInterval(() => {
      this.metrics = this.collectMetrics()
      this.history.push({
        timestamp: new Date(),
        metrics: { ...this.metrics },
      })
      
      // 保持历史记录在限制范围内
      if (this.history.length > this.maxHistory) {
        this.history.shift()
      }
      
      // 检查性能问题
      this.checkPerformanceIssues()
    }, 10000)
  }
  
  private collectMetrics(): PerformanceMetrics {
    const tasks = listTasks()
    const memoryUsage = process.memoryUsage()
    
    return {
      taskCount: tasks.length,
      runningTasks: tasks.filter(t => t.status === "running").length,
      queuedTasks: tasks.filter(t => t.status === "pending").length,
      completedTasks: tasks.filter(t => t.status === "completed").length,
      failedTasks: tasks.filter(t => t.status === "failed").length,
      averageDuration: this.calculateAverageDuration(tasks),
      memoryUsage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
      storageUsage: this.calculateStorageUsage(),
      cpuUsage: this.calculateCpuUsage(),
    }
  }
  
  private calculateAverageDuration(tasks: Task[]): number {
    const completedTasks = tasks.filter(t => t.status === "completed" && t.completedAt)
    if (completedTasks.length === 0) return 0
    
    const totalDuration = completedTasks.reduce((sum, task) => {
      const start = new Date(task.createdAt).getTime()
      const end = new Date(task.completedAt!).getTime()
      return sum + (end - start)
    }, 0)
    
    return Math.round(totalDuration / completedTasks.length / 1000)
  }
  
  private calculateStorageUsage(): number {
    // 计算存储使用率
    return 0
  }
  
  private calculateCpuUsage(): number {
    // 计算 CPU 使用率
    return 0
  }
  
  private checkPerformanceIssues() {
    // 检查内存使用率
    if (this.metrics.memoryUsage > 90) {
      console.warn("内存使用率过高：" + this.metrics.memoryUsage + "%")
    }
    
    // 检查存储使用率
    if (this.metrics.storageUsage > 90) {
      console.warn("存储使用率过高：" + this.metrics.storageUsage + "%")
    }
    
    // 检查排队任务数
    if (this.metrics.queuedTasks > 50) {
      console.warn("排队任务过多：" + this.metrics.queuedTasks)
    }
    
    // 检查失败任务数
    if (this.metrics.failedTasks > 10) {
      console.warn("失败任务过多：" + this.metrics.failedTasks)
    }
  }
  
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics }
  }
  
  getHistory(): Array<{ timestamp: Date; metrics: PerformanceMetrics }> {
    return [...this.history]
  }
  
  getReport() {
    const metrics = this.getMetrics()
    const history = this.getHistory()
    
    return {
      current: metrics,
      trends: {
        taskCount: this.calculateTrend(history.map(h => h.metrics.taskCount)),
        memoryUsage: this.calculateTrend(history.map(h => h.metrics.memoryUsage)),
        storageUsage: this.calculateTrend(history.map(h => h.metrics.storageUsage)),
      },
      recommendations: this.generateRecommendations(metrics),
    }
  }
  
  private calculateTrend(values: number[]): "increasing" | "decreasing" | "stable" {
    if (values.length < 2) return "stable"
    
    const first = values[0]
    const last = values[values.length - 1]
    const change = ((last - first) / first) * 100
    
    if (change > 10) return "increasing"
    if (change < -10) return "decreasing"
    return "stable"
  }
  
  private generateRecommendations(metrics: PerformanceMetrics): string[] {
    const recommendations: string[] = []
    
    if (metrics.memoryUsage > 80) {
      recommendations.push("建议减少并发任务数或增加内存限制")
    }
    
    if (metrics.storageUsage > 80) {
      recommendations.push("建议清理过期任务或增加存储限制")
    }
    
    if (metrics.queuedTasks > 20) {
      recommendations.push("建议增加并发任务数或优化任务执行效率")
    }
    
    if (metrics.failedTasks > 5) {
      recommendations.push("建议检查失败原因并优化错误处理")
    }
    
    return recommendations
  }
}
```

**使用方式**：

```typescript
const performanceMonitor = new PerformanceMonitor()

// 定期输出性能报告
setInterval(() => {
  const report = performanceMonitor.getReport()
  console.log("性能报告：", report)
}, 60000)
```

### 资源管理策略

#### 策略 1：动态并发控制

```typescript
class DynamicConcurrencyManager extends ConcurrencyManager {
  private performanceMonitor: PerformanceMonitor
  
  constructor(config: ConcurrencyConfig, performanceMonitor: PerformanceMonitor) {
    super(config)
    this.performanceMonitor = performanceMonitor
  }
  
  private adjustConcurrency() {
    const metrics = this.performanceMonitor.getMetrics()
    
    // 根据内存使用率调整并发数
    if (metrics.memoryUsage > 80) {
      this.config.maxConcurrent = Math.max(1, this.config.maxConcurrent - 1)
      console.log(`内存使用率过高，减少并发数至 ${this.config.maxConcurrent}`)
    } else if (metrics.memoryUsage < 50 && this.config.maxConcurrent < 5) {
      this.config.maxConcurrent += 1
      console.log(`内存使用率正常，增加并发数至 ${this.config.maxConcurrent}`)
    }
    
    // 根据 CPU 使用率调整并发数
    if (metrics.cpuUsage > 80) {
      this.config.maxConcurrent = Math.max(1, this.config.maxConcurrent - 1)
      console.log(`CPU 使用率过高，减少并发数至 ${this.config.maxConcurrent}`)
    }
  }
}
```

#### 策略 2：优先级队列

```typescript
interface PriorityTask {
  task: () => Promise<any>
  priority: number  // 优先级（1-10，10 最高）
  resolve: Function
  reject: Function
}

class PriorityQueue {
  private queue: PriorityTask[] = []
  
  enqueue(task: PriorityTask) {
    this.queue.push(task)
    this.queue.sort((a, b) => b.priority - a.priority)
  }
  
  dequeue(): PriorityTask | undefined {
    return this.queue.shift()
  }
  
  size(): number {
    return this.queue.length
  }
  
  clear() {
    this.queue = []
  }
}
```

#### 策略 3：资源预留

```typescript
interface ResourceReservation {
  memoryMB: number
  cpuPercent: number
  storageMB: number
}

class ResourceManager {
  private reservations = new Map<string, ResourceReservation>()
  private totalResources: ResourceReservation
  
  constructor(totalResources: ResourceReservation) {
    this.totalResources = totalResources
  }
  
  reserve(taskID: string, resources: ResourceReservation): boolean {
    const available = this.getAvailableResources()
    
    if (
      resources.memoryMB > available.memoryMB ||
      resources.cpuPercent > available.cpuPercent ||
      resources.storageMB > available.storageMB
    ) {
      return false
    }
    
    this.reservations.set(taskID, resources)
    return true
  }
  
  release(taskID: string) {
    this.reservations.delete(taskID)
  }
  
  getAvailableResources(): ResourceReservation {
    const used = this.getUsedResources()
    
    return {
      memoryMB: this.totalResources.memoryMB - used.memoryMB,
      cpuPercent: this.totalResources.cpuPercent - used.cpuPercent,
      storageMB: this.totalResources.storageMB - used.storageMB,
    }
  }
  
  private getUsedResources(): ResourceReservation {
    const used: ResourceReservation = {
      memoryMB: 0,
      cpuPercent: 0,
      storageMB: 0,
    }
    
    for (const reservation of this.reservations.values()) {
      used.memoryMB += reservation.memoryMB
      used.cpuPercent += reservation.cpuPercent
      used.storageMB += reservation.storageMB
    }
    
    return used
  }
}
```

### 实现优先级

**阶段 1**：实现基础资源管理
1. 并发控制（限制同时运行的任务数）
2. 内存监控（定期检查内存使用）
3. 存储清理（定期清理过期任务）

**阶段 2**：增强性能监控
1. 性能指标收集
2. 性能报告生成
3. 性能问题告警

**阶段 3**：实现高级资源管理
1. 动态并发控制
2. 优先级队列
3. 资源预留

### 设计要点

1. **并发控制**：限制同时运行的任务数，避免资源耗尽
2. **内存管理**：定期清理已完成任务，避免内存泄漏
3. **存储管理**：清理过期任务和大文件，避免磁盘占满
4. **性能监控**：实时监控资源使用，及时发现和处理问题
5. **动态调整**：根据资源使用情况动态调整并发策略

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
