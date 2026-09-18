# Gitdeck 분석 및 활용 정리 (한국어)

> 이 문서는 Gitdeck 저장소를 직접 분석하며 나눈 대화를 정리한 기록입니다.
> 프로젝트 규약(`AGENTS.md`)상 코드/식별자/파일명은 영어를 유지하되,
> 본 문서는 요청에 따라 한국어로 작성되었습니다.

## 🔗 저장소 주소

| 구분 | 주소 |
| --- | --- |
| 이 저장소 (포크) | https://github.com/bmshin94/gitdeck |
| 원본 (업스트림) | https://github.com/debba/gitdeck |
| 이전 이름 | https://github.com/debba/gh-dashboard |
| 커뮤니티 | https://discord.gg/YrZPHAwMSG |
| 라이선스 | MIT — https://github.com/bmshin94/gitdeck/blob/main/LICENSE |

---

## 1. Gitdeck은 무엇인가

GitHub / GitLab / Forgejo(Codeberg, 자체 호스팅) 계정의 저장소, 이슈, PR, 트래픽,
CI 활동을 **로컬에서 실행되는 단일 대시보드**로 모아 보는 오픈소스 프로젝트입니다.

- 버전: `v1.0.8`
- 규모: TS/TSX/CSS 약 **22,800줄 / 119개 파일**
- 테스트: Vitest 스펙 **24개**
- 라이선스: **MIT**

### 핵심 설계 철학

> **GitHub 토큰은 절대 브라우저로 전달되지 않는다.**

- 토큰은 `~/.gitdeck/`(Docker는 `/home/node/.gitdeck` 볼륨)에만 저장되고 Node 서버만 읽습니다.
- 브라우저는 `/api/*`만 호출하며, 서버가 대신 GitHub API를 호출합니다.
- 응답은 디스크에 캐싱되어 API 레이트리밋을 방어합니다.
- SaaS가 아닌 **로컬 앱**이므로 데이터가 외부 서버로 나가지 않습니다.
- 이 규칙은 `AGENTS.md`에 프로젝트 규약으로 명시되어 있습니다.

---

## 2. 아키텍처

```
gitdeck/
├── src/
│   ├── main.tsx / App.tsx        # React 19 진입점
│   ├── api/                      # 브라우저 → /api/* 클라이언트
│   ├── components/
│   │   ├── views/                # 화면 9개
│   │   ├── common/               # Avatar, Pagination, Markdown 등
│   │   └── modals/
│   ├── contexts/  hooks/         # 상태 관리
│   ├── i18n/                     # en, de, es, fr, it, zh  ← ko 없음
│   ├── server.ts                 # Node HTTP 서버 진입점
│   ├── server/
│   │   ├── app.ts, router.ts     # find-my-way 기반 라우터
│   │   ├── routes/               # auth, accounts, dashboard, repository,
│   │   │                         #   mentions, projects, notifications
│   │   ├── providers/            # github.ts, gitlab.ts, forgejo.ts, registry.ts
│   │   ├── graphql/              # GraphQL 문서
│   │   ├── oauth.ts, tokenStore.ts, authProvider.ts
│   │   ├── repoInsights.ts, securityAlerts.ts, ciHealth.ts, digests.ts
│   │   ├── snapshots.ts, statsCache.ts   # 캐싱
│   │   └── openaiDigest.ts       # OpenAI 요약 (선택 기능)
│   └── utils/                    # 순수 로직 19개 파일 (전부 테스트 존재)
├── tests/                        # src 구조를 미러링한 Vitest 스펙
├── Dockerfile / docker-compose.yml
└── .github/workflows/dockerbuild.yml
```

### 데이터 흐름

```
[브라우저]  →  /api/repos  →  [Node 서버]  →  api.github.com
 (토큰 없음)                  (토큰 보유)
                                   ↓
                             [디스크 캐시]
```

### 기술 스택

| 레이어 | 기술 |
| --- | --- |
| 언어 | TypeScript 5.7 |
| 프론트엔드 | React 19.2, Vite 8, react-router-dom 7 |
| 백엔드 | Node `http` + find-my-way, 개발 시 `tsx watch`, 빌드 시 esbuild |
| 테스트 | Vitest 4 + jsdom |
| 배포 | Docker 멀티스테이지, non-root 실행 |

### 주요 화면

| 화면 | 설명 |
| --- | --- |
| RepoGrid | 저장소 카드 그리드 (스타/포크/이슈/최근 푸시 + 건강 점수) |
| IssueList / PullRequestList | 여러 저장소의 이슈·PR을 한 목록으로 통합 트리아지 |
| InsightsView | 자동 경고(이슈 적체, 보안 경고, N일 무푸시) + Strong/Watch/Risky 등급 |
| CIHealthView | GitHub Actions 워크플로우 성공/실패 추이 |
| DailyDigestView | 일일 변화 요약 + (선택) OpenAI 서술형 요약 |
| KanbanView | 이슈 칸반 보드 (Backlog / To-do / In progress / Ready / In review) |
| InboxView | 알림 통합 수신함 |
| TriageWorkspace | 이슈 정리 전용 작업 공간 |
| 저장소 상세 | 트래픽(14일), 릴리즈, 포크, 기여자, 언어 분포, Mentions, Dependents |

---

## 3. 설치 및 사용법

요구사항: **Node.js 20+** (native fetch / ESM 지원)

### 방법 A — `gh` CLI 모드 (가장 간단, 권장)

OAuth 앱을 만들 필요가 없습니다.

```bash
gh auth login
gh auth refresh -h github.com -s repo,read:org,project

npm install
export GH_AUTH_MODE=gh-cli
npm run dev     # http://127.0.0.1:5173
```

서버는 요청마다 `gh auth token`을 실행해 토큰을 읽고 프로세스 내에서 60초간 캐싱합니다.

### 방법 B — OAuth Device Flow (기본값)

1. https://github.com/settings/developers → OAuth Apps → New OAuth App
   - Application name: `Gitdeck (local)`
   - Homepage URL: `http://127.0.0.1:8765`
   - Authorization callback URL: `http://127.0.0.1:8765`
2. **앱 설정에서 `Enable Device Flow` 체크 필수**
   (누락 시 `unsupported_grant_type` 오류 발생)
3. **Client ID만** 복사 (`Iv1.xxx` 또는 `Ov23li...`).
   Client Secret은 생성하지 않습니다 — Device Flow는 사용하지 않습니다.

```bash
export GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
npm install && npm run dev
```

4. 화면에 표시된 user code를 https://github.com/login/device 에 입력하고 승인합니다.

### 방법 C — 개인 액세스 토큰 (헤드리스/CI)

```bash
export GH_AUTH_MODE=token
export GITHUB_TOKEN=ghp_xxxxx
npm run dev
```

### 방법 D — Docker

```bash
cat > .env <<'EOF'
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-...
EOF
docker compose up -d --build     # http://127.0.0.1:8765
```

### 명령어

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | API(8765) + Vite(5173) 동시 실행 |
| `npm run api` | 백엔드만 실행 |
| `npm run build` | 서버 esbuild 번들 + SPA 빌드 → `dist/` |
| `npm start` / `npm run serve` | 프로덕션 (8765 단일 포트로 API + SPA) |
| `npm test` | Vitest 실행 |
| `npm run typecheck` | `tsc --noEmit` |

### 환경 변수

| 변수 | 필수 | 기본값 | 용도 |
| --- | --- | --- | --- |
| `GH_AUTH_MODE` | 아니오 | `device` | `device` / `gh-cli` / `token` |
| `GITHUB_CLIENT_ID` | device일 때만 | — | OAuth 앱 Client ID |
| `GITHUB_TOKEN` | token일 때만 | — | 개인 액세스 토큰 |
| `GITHUB_OAUTH_SCOPES` | 아니오 | `repo read:org project read:user user:email` | 요청 스코프 |
| `HOST` / `PORT` | 아니오 | `127.0.0.1` / `8765` | 바인딩 주소 |
| `OPENAI_API_KEY` | 아니오 | — | AI 다이제스트 요약 활성화 |
| `OPENAI_DIGEST_MODEL` | 아니오 | `gpt-4.1-mini` | 요약 모델 |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` | 아니오 | — | GitLab OAuth |
| `GITLAB_REDIRECT_URI` | 아니오 | 요청에서 추론 | `/api/auth/gitlab/callback`로 끝나야 함 |
| `GITLAB_OAUTH_INSTANCE_URL` | 아니오 | `https://gitlab.com` | 자체 호스팅 인스턴스 |
| `GITDECK_DIAGNOSTICS` | 아니오 | — | `1`이면 프로바이더 호출 시간 로깅 |

---

## 4. 플러그인인가, 스킬인가, MCP인가?

**셋 다 아닙니다. 독립 실행형 웹 애플리케이션입니다.**

저장소를 직접 확인한 근거:

| 확인 항목 | 결과 |
| --- | --- |
| `@modelcontextprotocol/*` 의존성 | 없음 (의존성은 react, react-dom, react-router-dom, react-markdown, remark-gfm, find-my-way 6개뿐) |
| MCP 매니페스트 (`mcp.json` 등) | 없음 |
| Claude Code 플러그인 구조 (`.claude/plugins/`, `.claude-plugin/`) | 없음 |
| Skill 구조 (`SKILL.md`, `skills/`) | 없음 |
| stdio / JSON-RPC 핸들러 | 없음 — 전부 HTTP REST (`router.get("/api/repos", ...)`) |

- 루트의 `CLAUDE.md`는 이 포크에서 추가한 어시스턴트 페르소나 문서이며 Gitdeck 기능과 무관합니다.
- `AGENTS.md` / `.agents/rules.md`는 실행 코드가 아니라 코딩 컨벤션 문서입니다.

다만 `/api/*` 표면이 잘 정리되어 있어 **MCP 서버로 감싸기에는 매우 좋은 재료**입니다(6장 참고).

---

## 5. API 토큰이 필요한가?

**GitHub 접근 토큰은 반드시 필요합니다.** (미인증 GitHub API는 시간당 60회 제한)

| 모드 | 토큰 출처 | 직접 생성 필요 |
| --- | --- | --- |
| `gh-cli` | 기존 `gh` CLI 세션 | 불필요 |
| `device` | OAuth 앱 + 디바이스 승인 | OAuth 앱만 (시크릿 불필요) |
| `token` | 개인 액세스 토큰 | 필요 |

- 기본 스코프: `repo read:org project read:user user:email`
  - `GITHUB_OAUTH_SCOPES`로 축소 가능하지만, 트래픽 통계와 보안 경고는 `repo`가 필요해 일부 화면이 비어 보일 수 있습니다.
- **`OPENAI_API_KEY`는 완전 선택사항**입니다. 없으면 Daily Digest의 AI 서술 요약만 비활성화되고
  (`openaiDigest.ts`의 `hasOpenAIConfig()`가 확인), 숫자 집계·하이라이트 등 나머지는 정상 작동합니다.
- 권한 회수: https://github.com/settings/applications 에서 앱 제거 + `~/.gitdeck/` 삭제

---

## 6. 로컬 에이전트 구축에 도움이 되는가

Gitdeck 자체는 에이전트가 아니지만, **에이전트 구축에 필요한 어려운 부분이 이미 구현되어 있습니다.**

| 자산 | 파일 | 에이전트 관점의 가치 |
| --- | --- | --- |
| 인증 3종 | `oauth.ts`, `tokenStore.ts`, `authProvider.ts` | Device Flow / gh-cli / PAT 처리 완료 |
| 프로바이더 추상화 | `providers/registry.ts`, `types.ts` | 도구 하나로 GitHub/GitLab/Forgejo 커버 |
| 캐싱·중복 제거 | `snapshots.ts`, `statsCache.ts` | 반복 질의 시 레이트리밋 방어 |
| **가공된 인사이트** | `repoInsights.ts`, `securityAlerts.ts`, `ciHealth.ts`, `digests.ts` | 원시 JSON이 아닌 **요약된 판단 결과** 제공 |
| LLM 호출 패턴 | `openaiDigest.ts` | 프롬프트 조립 → 호출 → 구조화 응답 파싱 예제 |
| REST 표면 | `routes/*.ts` (약 30개 엔드포인트) | 그대로 도구 목록이 됨 |

### 왜 `repoInsights.ts`가 중요한가

LLM에 GitHub 원시 JSON을 그대로 넘기면 토큰이 폭증하고 성능이 떨어집니다.
Gitdeck은 이미 다음과 같이 압축합니다:

```
repo-A: Risky — 이슈 12건 적체, 보안 경고 3건, 27일간 푸시 없음
```

즉 **요약 레이어를 직접 만들 필요가 없습니다.**

### MCP 서버로 감싸는 예시

```ts
server.tool("gitdeck_repo_insights", {
  description: "모든 저장소의 건강 상태와 위험 신호를 반환한다",
  inputSchema: { org: z.string().optional() },
  handler: async (args) =>
    await fetch(`http://127.0.0.1:8765/api/repo-insights?org=${args.org ?? ""}`)
      .then((r) => r.json()),
});
```

`/api/repos`, `/api/issues`, `/api/prs`, `/api/ci-health`, `/api/daily-digests`,
`/api/notifications` 등에 같은 방식을 반복 적용하면 됩니다.

### 한계

- Gitdeck은 **읽기 중심**입니다. 쓰기는 `/api/project/move`(칸반 이동),
  `/api/notifications/read`, `/api/repo-aliases` 정도이며,
  이슈 생성·PR 머지 같은 액션은 직접 추가해야 합니다.
- MCP 래퍼가 동작하려면 HTTP 서버가 떠 있어야 합니다(Docker 상주로 해결 가능).

---

## 7. 왜 GitHub에서 주목받는가

> 참고: 실시간 스타 수는 이 분석 시점에 조회하지 않았습니다. 아래는 구조적 요인 분석입니다.

1. **보편적 문제 해결** — 저장소가 여러 개면 GitHub 웹 UI만으로는 불편합니다.
2. **Local-first / 프라이버시 서사** — "토큰이 브라우저로 안 간다", "내 PC에서 돈다".
3. **멀티 포지 지원** — GitHub만 지원하는 경쟁자와 달리 GitLab·Forgejo 커뮤니티까지 포괄.
4. **강한 첫인상** — README 상단의 `public/demo.gif`, RepoStars·Discord 배지.
5. **Discord 커뮤니티 운영** — 이슈 트래커보다 진입 장벽이 낮음.
6. **낮은 기여 난이도** — 화면 1개 = 파일 1개, 프로바이더 1개 = 파일 1개, 번역 1개 = 파일 1개.
7. **정직한 AI 서사** — "초기 스캐폴딩은 Claude Code, 이후 사람이 리뷰·유지보수".
8. **유지보수 신뢰도** — Conventional Commits, 자동 CHANGELOG, 테스트 24개, Docker 워크플로우.

---

## 8. React / PHP로 만들 수 있는가

### React

**이미 React입니다.** React 19.2 + Vite 8 + react-router-dom 7 구성입니다.
React를 다룰 수 있다면 `src/components/views/`에서 바로 작업을 시작할 수 있습니다.

바로 시도해볼 만한 작업:

- `src/i18n/ko.ts` 추가 (**현재 한국어 번역이 없음** — 난이도 낮고 임팩트 큼)
- `views/`에 새 화면 추가 (예: "내가 리뷰해야 할 PR만")
- `styles/`의 CSS 토큰으로 테마 커스터마이징

### PHP

프론트엔드는 `/api/*`만 호출하므로 **백엔드만 PHP로 교체하고 React 프론트엔드는 재사용**할 수 있습니다.

| Node | PHP 대응 |
| --- | --- |
| find-my-way 라우터 | Slim 4 / Laravel |
| `fetch` | Guzzle |
| `~/.gitdeck/` 파일 저장 | 파일 저장 또는 SQLite |
| 디스크 캐시 | Symfony Cache / APCu |
| GraphQL 문서 | 문자열이므로 그대로 재사용 가능 |
| `tsx watch` | `php -S` / Laravel Octane |

난이도 평가:

- 쉬움: REST 프록시, 토큰 저장, OAuth Device Flow(HTTP 호출 3회)
- 보통: 캐시 무효화 전략, 동시 요청 병합
- 어려움: Node가 `Promise.all`로 다수 API를 병렬 호출하는 부분
  → PHP는 기본이 동기라 `curl_multi` 또는 ReactPHP/Amp가 필요
- 어려움: `tsx watch` 수준의 개발 편의성 재현

권장 선택:

| 목표 | 권장 |
| --- | --- |
| 그냥 사용 | 현재 구성 그대로, `gh-cli` 모드 |
| 커스터마이징 | React 프론트엔드만 수정 |
| 학습 목적 | 전체 재작성 대신 `providers/`에 새 포지(Gitea, Bitbucket) 추가 |
| PHP 서버 자산 보유 | React 프론트 재사용 + PHP 백엔드 |
| PHP 전면 재작성 | 비권장 (병렬 처리 비용 대비 이득 적음) |

---

## 9. 수익화 아이디어

### 법적 전제

Gitdeck은 **MIT 라이선스**입니다.

- 상업적 이용 가능, 수정본 비공개 가능(GPL과 다름)
- **조건**: 저작권 표기와 MIT 라이선스 전문을 배포물에 포함해야 함
- 원작자 이름/상표를 사칭해서는 안 됨
- 매너: 별도 제품으로 판매한다면 리브랜딩하고, README에 원본 출처 링크를 남기는 것이 권장됨

### 아이디어 목록

| # | 아이디어 | 난이도 | 수익성 | 소요 | 리스크 | 종합 |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 아침 브리핑 구독 (이메일/슬랙 자동 발송) | 낮음 | 높음 | 2주 | 낮음 | **9/10** |
| 4 | AI 에이전트 번들 (Gitdeck + MCP) | 중간 | 매우 높음 | 1달 | 중간 | **9/10** |
| 8 | 교육 콘텐츠 (코드베이스 해부 강의) | 낮음 | 중간 | 3주 | 최저 | **8/10** |
| 6 | 한국 시장 특화 버전 | 낮음 | 중간 | 3주 | 낮음 | **8/10** |
| 3 | OSS 헬스 리포트 1회성 판매 | 낮음 | 중간 | 2주 | 낮음 | 7/10 |
| 5 | 엔터프라이즈 온프레미스 라이선스 | 높음 | 매우 높음 | 6개월 | 중간 | 7/10 |
| 1 | 매니지드 호스팅 SaaS | 중간 | 높음 | 2개월 | **높음** | 6/10 |
| 7 | 테마 / 플러그인 마켓 | 낮음 | 낮음 | 2주 | 낮음 | 5/10 |
| 9 | 스폰서십 / 컨설팅 | 최저 | 낮음 | — | 낮음 | 5/10 |
| 10 | 데이터 인텔리전스 리포트 | 높음 | 중간 | 3개월 | **높음** | 4/10 |

### 상세

**1. 매니지드 호스팅 (Open-core SaaS)**
설치가 번거로운 사용자를 대상으로 한 호스팅 서비스.
Free(저장소 3개) / Pro $9월 / Team $29월 구조.
**리스크**: 타인의 GitHub 토큰을 서버에 보관하는 보안 책임. 암호화 저장·최소 권한·감사 로그 필수.

**2. 아침 브리핑 구독** — 가성비 최상
`digests.ts` + `openaiDigest.ts`가 이미 구현되어 있어 "이메일/슬랙 발송"만 추가하면 됩니다.
대시보드는 접속해야 보이지만 브리핑은 먼저 도달하므로 이탈률이 낮습니다.
가격: 개인 $5~15/월, 팀 $49/월.

**3. OSS 헬스 리포트 1회성 판매**
`repoInsights.ts`의 Strong/Watch/Risky 등급 + 보안 경고 + 트래픽을 리포트로 판매.
대상: 스타트업 CTO, VC 실사팀. 가격: 저장소당 $49~299.
무료는 점수만, 유료는 액션 리스트 제공하는 구조가 전환율이 좋습니다.

**4. AI 에이전트 번들 (MCP)** — 잠재력 최상
Gitdeck을 MCP 서버로 감싸 "GitHub AI 비서"로 판매.
대부분의 GitHub MCP는 원시 API를 감싸 토큰 소모가 크지만,
Gitdeck은 요약된 인사이트를 제공해 토큰 효율이 훨씬 좋습니다.
가격: Pro $19/월, 팀 $99/월. MCP 생태계 초기라 선점 효과가 큽니다.

**5. 엔터프라이즈 온프레미스 라이선스**
Dockerfile과 멀티 포지 지원이 이미 있어 기반이 갖춰져 있습니다.
추가 필요: SSO/SAML, 감사 로그, RBAC, 설치 지원.
가격: 연 $3,000~30,000. GitLab 자체 호스팅 + Forgejo 지원이 폐쇄망 기업에 강점입니다.

**6. 한국 시장 특화 버전**
`src/i18n/`에 `ko.ts`가 없다는 틈새가 있습니다.
① 한국어 번역 PR로 기여 → ② 네이버웍스/카카오워크/잔디 알림 연동, 사내 GitLab 대응 →
③ 국내 SI·스타트업 대상 판매. 경쟁이 거의 없습니다.

**7. 테마 & 플러그인 마켓**
프리미엄 테마, 커스텀 위젯, 산업별 템플릿. $5~30/개.

**8. 교육 콘텐츠** — 리스크 최저
"React 19 + Node로 실전 대시보드 만들기 — 22,000줄 오픈소스 해부" 형태의 강의.
React 19, Vite 8, OAuth Device Flow, GraphQL, 캐싱 전략, 프로바이더 추상화, Vitest, Docker를 다룹니다.
서버 비용과 고객 지원 부담이 없습니다. 가격 $30~150.

**9. 스폰서십 / 컨설팅**
GitHub Sponsors, Open Collective, 기업 커스터마이징 컨설팅(시간당 $80~200).

**10. 데이터 인텔리전스**
트래픽/스타 추이 익명 집계 → 오픈소스 트렌드 리포트($500~5,000).
**반드시 옵트인 기반이어야 합니다.** 동의 없는 집계는 신뢰를 파괴합니다.

### 실행 로드맵 제안

```
1~2주차   ko.ts 한국어 번역 PR (원작자와 관계 형성 + 코드베이스 이해)
   ↓
3~6주차   MCP 래퍼 공개 (수요 검증 + 초기 사용자 확보)
   ↓
2~3개월   "아침 브리핑" 유료화 (MCP 사용자를 유료 전환)
   ↓
4~6개월   과정을 강의/글로 판매 (동일 노력의 2차 수익화)
```

### 핵심 원칙

1. 대시보드가 아니라 **결론**을 판다 — 사용자는 "무엇을 해야 하는가"의 답에 돈을 냅니다.
2. 커뮤니티를 적으로 만들지 않는다 — 기여가 먼저, 수익화는 그다음.
3. MCP 생태계는 초기 단계이므로 타이밍이 중요합니다.

---

## 10. 요약

- Gitdeck은 **로컬에서 실행되는 멀티 포지 개발 대시보드**이며, MCP도 플러그인도 스킬도 아닌 **독립 웹앱**입니다.
- GitHub 토큰은 필요하지만 `gh-cli` 모드를 쓰면 별도 설정이 거의 없습니다. OpenAI 키는 선택입니다.
- 프론트엔드는 이미 React 19이며, PHP로는 백엔드만 교체하는 방식이 현실적입니다.
- 로컬 에이전트 구축에는 **요약 레이어(`repoInsights.ts` 등)** 가 특히 유용한 자산입니다.
- 수익화는 **아침 브리핑 구독**과 **MCP 에이전트 번들**이 노력 대비 효과가 가장 큽니다.
- 가장 빠른 첫걸음은 **`src/i18n/ko.ts` 한국어 번역 추가**입니다.
