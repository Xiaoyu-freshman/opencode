# Bus-Worker 故障排除指南

Status: 2026-05-27.

## 常见问题

### 1. 代理配置未生效

**症状**：启动 OpenCode 后看不到 bus 或 bus-worker-* 代理

**可能原因**：
- 配置文件路径错误
- YAML frontmatter 格式错误
- OpenCode 未重新加载配置

**解决方案**：
```bash
# 1. 检查文件位置
ls -la .opencode/agent/bus*.md

# 2. 验证 YAML 格式
head -30 .opencode/agent/bus.md

# 3. 重启 OpenCode
# 退出并重新启动 OpenCode TUI
```

### 2. 工具无法执行

**症状**：调用 worktree 工具时提示 "tool not found" 或执行失败

**可能原因**：
- 工具文件路径错误
- TypeScript 编译错误
- 权限配置问题

**解决方案**：
```bash
# 1. 检查工具文件
ls -la .opencode/tool/worktree.ts

# 2. 测试编译
bun build --no-bundle .opencode/tool/worktree.ts --outdir /tmp/test

# 3. 检查权限配置
grep -A 20 "permission:" .opencode/agent/bus.md
```

### 3. Worktree 创建失败

**症状**：worktree.create 操作报错

**可能原因**：
- Git 仓库状态异常
- 目标分支已存在
- 磁盘空间不足
- 权限问题

**解决方案**：
```bash
# 1. 检查 Git 状态
git status
git worktree list

# 2. 清理孤立 worktree
git worktree prune

# 3. 检查分支是否存在
git branch -a | grep codex/

# 4. 手动测试 worktree 创建
git worktree add -b codex/test-$(date +%Y%m%d) ../_worktrees/test main
```

### 4. Worker 权限问题

**症状**：Worker 无法执行预期操作或权限过宽

**可能原因**：
- 权限配置错误
- 继承规则问题
- 工具权限未正确映射

**解决方案**：
```bash
# 1. 检查 Worker 配置
cat .opencode/agent/bus-worker-implementation.md

# 2. 验证权限字段
grep -A 30 "permission:" .opencode/agent/bus-worker-implementation.md

# 3. 测试权限边界
# 在 OpenCode 中切换到 Worker 代理，尝试：
# - 读取文件（应该成功）
# - 编辑文件（应该成功）
# - 运行 bash（应该失败）
```

### 5. Task 工具无法创建子会话

**症状**：task 工具调用失败或无法生成子会话

**可能原因**：
- 代理名称错误
- 子代理类型不存在
- 权限不足

**解决方案**：
```bash
# 1. 检查代理列表
# 在 OpenCode TUI 中输入 @ 查看可用代理

# 2. 验证代理名称
grep "mode:" .opencode/agent/bus-worker-*.md

# 3. 检查 task 工具权限
grep "task:" .opencode/agent/bus.md
```

### 6. 权限配置语法错误

**症状**：OpenCode 启动时报配置解析错误

**可能原因**：
- YAML 缩进错误
- 字段名拼写错误
- 值类型错误

**解决方案**：
```bash
# 1. 验证 YAML 语法
# 使用在线 YAML 验证器或：
python3 -c "import yaml; yaml.safe_load(open('.opencode/agent/bus.md').read().split('---')[1])"

# 2. 检查常见错误
# - 确保使用空格缩进（不要用 tab）
# - 确保字段名正确（如 "permission" 不是 "permissions"）
# - 确保值类型正确（如 "allow" 是字符串，不是布尔值）
```

### 7. 环境变量问题

**症状**：工具执行时提示环境变量未设置

**可能原因**：
- 环境变量未导出
- 路径问题
- 权限限制

**解决方案**：
```bash
# 1. 检查环境变量
echo $PATH
echo $GITHUB_TOKEN

# 2. 测试工具执行
which git
git --version

# 3. 检查 OpenCode 环境
# 在 OpenCode 中运行：
# bash: echo $PATH
```

## 调试技巧

### 启用详细日志

```bash
# 启动 OpenCode 时启用调试日志
opencode --log-level DEBUG

# 或查看日志文件
tail -f ~/.opencode/logs/opencode.log
```

### 测试工具隔离

```bash
# 在临时目录测试工具
mkdir /tmp/test-opencode
cd /tmp/test-opencode
git init

# 复制工具文件
cp /path/to/.opencode/tool/worktree.ts .opencode/tool/

# 测试工具
bun run .opencode/tool/worktree.ts
```

### 验证权限配置

```bash
# 创建测试代理配置
cat > .opencode/agent/test-agent.md << 'EOF'
---
mode: subagent
description: Test agent for permission verification
permission:
  "*": deny
  read: allow
  edit: allow
  bash: deny
---
Test agent prompt.
EOF

# 在 OpenCode 中切换到测试代理，验证权限
```

## 恢复步骤

### 重置代理配置

```bash
# 备份当前配置
cp -r .opencode/agent .opencode/agent.backup

# 恢复默认配置
rm .opencode/agent/bus*.md
rm .opencode/agent/bus-worker-*.md

# 重新创建配置
# 参考 CONFIGURATION_GUIDE.md
```

### 清理 Worktree

```bash
# 列出所有 worktree
git worktree list

# 清理孤立 worktree
git worktree prune

# 强制删除问题 worktree
git worktree remove --force /path/to/worktree

# 删除相关分支
git branch -D codex/problem-branch-20260527
```

### 恢复主仓库状态

```bash
# 检查主仓库状态
git status
git stash list

# 恢复未提交的更改
git stash pop

# 或重置到干净状态
git checkout -- .
git clean -fd
```

## 预防措施

1. **定期备份**：重要配置修改前备份 `.opencode/` 目录
2. **测试隔离**：在测试环境中验证配置变更
3. **版本控制**：将配置文件纳入版本控制
4. **文档记录**：记录所有配置变更和原因

## 获取帮助

如果问题仍未解决：

1. 检查 OpenCode 官方文档
2. 搜索 GitHub Issues
3. 在 Discord 社区提问
4. 提交详细的错误报告，包括：
   - 错误信息
   - 复现步骤
   - 环境信息
   - 相关配置文件
