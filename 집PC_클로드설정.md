# 집 PC Claude Code 권한 설정

## 방법 1: settings.json 직접 생성 (권장)

아래 내용을 `C:\Users\{사용자이름}\.claude\settings.json`에 저장:

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Edit(*)",
      "Write(*)",
      "Read(*)",
      "Glob(*)",
      "Grep(*)",
      "WebFetch(*)",
      "WebSearch(*)"
    ]
  },
  "effortLevel": "high"
}
```

## 방법 2: /permissions 명령어

Claude Code 실행 후 `/permissions` 입력:

```
1. Add a new rule…
2. Bash       → allow
3. Edit       → allow
4. Glob       → allow
5. Grep       → allow
6. Read       → allow
7. WebFetch   → allow
8. WebSearch  → allow
9. Write      → allow
```

각 항목을 선택하고 `allow`로 설정하면 매번 yes 안 눌러도 됨.
