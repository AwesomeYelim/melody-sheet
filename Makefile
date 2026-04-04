# ── melody-sheet Makefile ─────────────────────────────────
SHELL   := /bin/zsh
PYTHON  := .venv/bin/python
PIP     := .venv/bin/pip
UVICORN := .venv/bin/uvicorn
PORT    := 8000
NVM_NODE := $(HOME)/.nvm/versions/node/v22.13.0/bin
export PATH := $(NVM_NODE):$(PATH)

.PHONY: all install build serve run stop clean

# ── 한 방에 실행 ──────────────────────────────────────────
all: stop build serve

# ── Python 가상환경 + 의존성 설치 ─────────────────────────
install:
	@echo "⏳ Python 가상환경 생성..."
	test -d .venv || python3 -m venv .venv
	$(PIP) install -r requirements.txt
	@echo "⏳ Node 패키지 설치..."
	cd app && npm install
	@echo "✅ 설치 완료"

# ── 프론트엔드 빌드 ──────────────────────────────────────
build:
	@echo "⏳ 웹 빌드 중..."
	cd app && npx expo export --platform web
	@echo "✅ 빌드 완료"

# ── 서버 실행 ─────────────────────────────────────────────
serve:
	@echo "🚀 서버 시작 (port $(PORT))..."
	$(UVICORN) main:app --host 0.0.0.0 --port $(PORT)

# ── 빌드 + 서버 (백그라운드) ──────────────────────────────
run: stop build
	@echo "🚀 서버 시작 (백그라운드, port $(PORT))..."
	nohup $(UVICORN) main:app --host 0.0.0.0 --port $(PORT) > /tmp/uvicorn.log 2>&1 &
	@sleep 2 && echo "✅ http://localhost:$(PORT)"

# ── 서버 종료 ─────────────────────────────────────────────
stop:
	@-lsof -ti:$(PORT) | xargs kill 2>/dev/null; true
	@echo "🛑 서버 종료"

# ── 정리 ──────────────────────────────────────────────────
clean:
	rm -rf app/dist
	@echo "🧹 dist 삭제"
