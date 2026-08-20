import { c, getLocale } from './cli-ui.js';

export function generateZshCompletion() {
  return `#compdef kbu-usage usage npx\\ @kimi.builders/usage

_kbu_usage_completion() {
  local -a commands
  commands=(
    'sync:从各个 Agent 扫描并同步用量数据'
    'stats:多维用量统计与趋势分析'
    'quota:查询 AI 平台订阅额度与重置倒计时'
    'limits:查询 AI 平台订阅额度 (quota 别名)'
    'top:按消耗量查看排行'
    'summary:用量汇总概览'
    'dashboard:启动本地可视化 Web 看板'
    'status:查看当前配置、连接与服务状态'
    'pricing:查看、更新或重置标准 API 价格目录'
    'export:导出本地用量数据为 CSV/JSON/JSONL'
    'doctor:执行离线数据一致性与协议体检'
    'inspect:离线调试与数据源目录探测'
    'sources:查看与管理各个 Agent 数据源模式'
    'daemon:后台自动定时同步服务管理'
    'init:连接至社区云端'
    'reset:重置本地同步检查点'
    'completion:生成 Shell 自动补全脚本'
  )

  local -a options
  options=(
    '--help[显示帮助信息]'
    '-h[显示帮助信息]'
    '--version[显示版本号]'
    '-v[显示版本号]'
    '--lang[设置输出语言]:language:(zh en)'
    '--no-color[禁用彩色输出]'
    '--plain[纯文本模式]'
    '--color[强制启用彩色输出]'
    '--json[以 JSON 格式输出]'
  )

  local line state
  _arguments -C \\
    '1: :->command' \\
    '*:: :->args' && return 0

  case $state in
    command)
      _describe -t commands 'kbu-usage 命令' commands
      _describe -t options '全局选项' options
      ;;
    args)
      case $words[1] in
        stats|top)
          _arguments \\
            '--period[统计时间周期]:period:(today 24h 7d 30d 90d all)' \\
            '--days[指定天数]:days:(1 7 14 30 60 90)' \\
            '--source[指定 Agent 来源]:source:(kimi-code claude-code codex opencode gemini-cli antigravity copilot-cli roo-code pi-coding-agent zcode workbuddy cursor)' \\
            '--model[按模型名模糊过滤]:model:' \\
            '--project[按项目名精确过滤]:project:' \\
            '--json[以 JSON 输出]' \\
            '--plain[纯文本模式]'
          ;;
        quota|limits)
          _arguments \\
            '--provider[指定 AI 平台]:provider:(claude-code codex kimi-code cursor copilot antigravity deepseek opencode warp qoder jetbrains-ai)' \\
            '--all[全量扫描所有平台]' \\
            '--force[强制刷新，绕过缓存]' \\
            '--json[以 JSON 输出]'
          ;;
        export)
          _arguments \\
            '--format[导出格式]:format:(csv json jsonl)' \\
            '--type[导出数据类型]:type:(buckets sessions summary all)' \\
            '--output[保存文件路径]:output:_files' \\
            '-o[保存文件路径]:output:_files' \\
            '--period[时间范围]:period:(today 24h 7d 30d 90d all)' \\
            '--source[指定 Agent 来源]:source:(kimi-code claude-code codex opencode antigravity cursor)'
          ;;
        sources)
          local -a subcommands
          subcommands=(
            'list:列出所有支持的数据源与状态'
            'set:设置数据源模式 (off/local/private)'
            'enable:启用显式数据源 (如 cursor)'
            'disable:停用数据源'
          )
          _describe -t subcommands 'sources 操作' subcommands
          ;;
        daemon)
          local -a daemon_subs
          daemon_subs=(
            'install:安装后台自动同步定时任务'
            'status:查看后台服务运行状态'
            'restart:重启后台同步服务'
            'uninstall:卸载后台同步服务'
            'run:立即执行一次后台同步'
          )
          _describe -t daemon_subs 'daemon 操作' daemon_subs
          ;;
        sync)
          _arguments \\
            '--full[全量同步模式]'
          ;;
        pricing)
          _arguments \\
            '1:操作:(status update reset)' \\
            '--api-url[社区地址]:url:' \\
            '--force[忽略 ETag 并重新下载]' \\
            '--json[以 JSON 输出]'
          ;;
        init)
          _arguments \\
            '--api-url[社区地址]:url:' \\
            '--sync[连接成功后立即同步允许的数据源]' \\
            '--skip-pricing-update[跳过公开价格目录更新]'
          ;;
      esac
      ;;
  esac
}

compdef _kbu_usage_completion kbu-usage usage "npx @kimi.builders/usage"
`;
}

export function generateBashCompletion() {
  return `#!/usr/bin/env bash
# Bash completion for @kimi.builders/usage

_kbu_usage_bash_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="sync stats quota limits top summary dashboard status pricing export doctor inspect sources daemon init reset completion"
  local global_opts="--help -h --version -v --lang --no-color --plain --color --json"

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands $global_opts" -- "$cur") )
    return 0
  fi

  case "\${words[1]}" in
    stats|top)
      COMPREPLY=( $(compgen -W "--period --days --source --model --project --json --plain" -- "$cur") )
      ;;
    quota|limits)
      COMPREPLY=( $(compgen -W "--provider --all --force --json" -- "$cur") )
      ;;
    export)
      COMPREPLY=( $(compgen -W "--format --type --output -o --period --source" -- "$cur") )
      ;;
    sources)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list set enable disable" -- "$cur") )
      fi
      ;;
    daemon)
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "install status restart uninstall run --interval --json" -- "$cur") )
      fi
      ;;
    sync)
      COMPREPLY=( $(compgen -W "--full" -- "$cur") )
      ;;
    pricing)
      COMPREPLY=( $(compgen -W "status update reset --api-url --force --json" -- "$cur") )
      ;;
    init)
      COMPREPLY=( $(compgen -W "--api-url --sync --skip-pricing-update" -- "$cur") )
      ;;
  esac
}

complete -F _kbu_usage_bash_completion kbu-usage usage "npx @kimi.builders/usage"
`;
}

export function generateFishCompletion() {
  return `# Fish completion for @kimi.builders/usage

set -l commands sync stats quota limits top summary dashboard status pricing export doctor inspect sources daemon init reset completion

complete -c kbu-usage -f
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a sync -d "从各个 Agent 扫描并同步用量数据"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a stats -d "多维用量统计与趋势分析"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a quota -d "查询 AI 平台订阅额度与重置倒计时"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a limits -d "查询 AI 平台订阅额度 (quota 别名)"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a top -d "按消耗量查看排行"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a summary -d "用量汇总概览"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a dashboard -d "启动本地可视化 Web 看板"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a status -d "查看当前配置与运行状态"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a pricing -d "查看、更新或重置价格目录"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a export -d "导出本地用量数据"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a doctor -d "执行离线数据一致性体检"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a inspect -d "离线调试与数据源目录探测"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a sources -d "管理各个 Agent 数据源模式"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a daemon -d "后台自动定时同步服务管理"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a init -d "连接至社区云端"
complete -c kbu-usage -n "not __fish_seen_subcommand_from $commands" -a reset -d "重置本地同步检查点"

complete -c kbu-usage -l help -s h -d "显示帮助信息"
complete -c kbu-usage -l version -s v -d "显示版本号"
complete -c kbu-usage -l lang -d "设置输出语言" -r -a "zh en"
complete -c kbu-usage -l no-color -d "禁用彩色输出"
complete -c kbu-usage -l plain -d "纯文本模式"
complete -c kbu-usage -l json -d "以 JSON 格式输出"
complete -c kbu-usage -n "__fish_seen_subcommand_from pricing" -a "status update reset"
complete -c kbu-usage -n "__fish_seen_subcommand_from pricing" -l api-url -d "社区地址" -r
complete -c kbu-usage -n "__fish_seen_subcommand_from pricing" -l force -d "忽略 ETag 并重新下载"
complete -c kbu-usage -n "__fish_seen_subcommand_from pricing" -l json -d "以 JSON 格式输出"
complete -c kbu-usage -n "__fish_seen_subcommand_from init" -l api-url -d "社区地址" -r
complete -c kbu-usage -n "__fish_seen_subcommand_from init" -l sync -d "连接成功后立即同步"
complete -c kbu-usage -n "__fish_seen_subcommand_from init" -l skip-pricing-update -d "跳过公开价格目录更新"
`;
}

export function runCompletion(shellArg) {
  const shell = String(shellArg || '').toLowerCase().trim();
  const isZh = getLocale() === 'zh';

  if (shell === 'zsh') {
    console.log(generateZshCompletion());
    return;
  }
  if (shell === 'bash') {
    console.log(generateBashCompletion());
    return;
  }
  if (shell === 'fish') {
    console.log(generateFishCompletion());
    return;
  }

  // Guide
  console.log(`\n${c.bold(c.cyan('◆ Shell 自动补全安装指南'))}`);
  console.log(c.dim('─'.repeat(Math.min(68, (process.stdout.columns || 80) - 2))));

  console.log(c.bold('1. Zsh (macOS 默认):'));
  console.log(`   ${c.cyan('source <(npx @kimi.builders/usage completion zsh)')}`);
  console.log(`   ${c.dim('或写入 ~/.zshrc 以持久生效:')}`);
  console.log(`   ${c.dim('echo "source <(npx @kimi.builders/usage completion zsh)" >> ~/.zshrc')}`);

  console.log(`\n${c.bold('2. Bash:')}`);
  console.log(`   ${c.cyan('source <(npx @kimi.builders/usage completion bash)')}`);

  console.log(`\n${c.bold('3. Fish:')}`);
  console.log(`   ${c.cyan('npx @kimi.builders/usage completion fish > ~/.config/fish/completions/kbu-usage.fish')}`);
  console.log(c.dim('─'.repeat(Math.min(68, (process.stdout.columns || 80) - 2))) + '\n');
}
