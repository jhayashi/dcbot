# dcbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Delta Chat bot CLI that bridges conversations to Anthropic's Claude API, with access control, conversation history modes, and media support.

**Architecture:** Monolithic Go binary using `deltabot-cli-go/v2` for Delta Chat integration, `modernc.org/sqlite` for storage, and the Anthropic REST API for Claude. The bot registers an `OnNewMsg` handler that routes messages through access control, command dispatch, history loading, and Claude API calls.

**Tech Stack:** Go, deltabot-cli-go v2, deltachat-rpc-client-go v2, modernc.org/sqlite, BurntSushi/toml, Go stdlib (net/http, encoding/json, slog)

**Spec:** `docs/superpowers/specs/2026-03-24-dcbot-design.md`

---

### Task 1: Project Scaffolding and Go Module Init

**Files:**
- Create: `go.mod`
- Create: `cmd/dcbot/main.go`
- Create: `.gitignore`

- [ ] **Step 1: Initialize Go module**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go mod init github.com/jhayashi/dcbot
```

- [ ] **Step 2: Create .gitignore**

Create `.gitignore`:
```
dcbot
*.db
*.db-wal
*.db-shm
.env
```

- [ ] **Step 3: Create minimal main.go with botcli skeleton**

Create `cmd/dcbot/main.go`:
```go
package main

import (
	"log"

	"github.com/deltachat-bot/deltabot-cli-go/v2/botcli"
	"github.com/chatmail/rpc-client-go/v2/deltachat"
	"github.com/spf13/cobra"
)

func main() {
	cli := botcli.New("dcbot")

	cli.OnBotInit(func(cli *botcli.BotCli, bot *deltachat.Bot, cmd *cobra.Command, args []string) {
		bot.OnNewMsg(func(bot *deltachat.Bot, accId uint32, msgId uint32) {
			msg, err := bot.Rpc.GetMessage(accId, msgId)
			if err != nil {
				return
			}
			if msg.FromId <= deltachat.ContactLastSpecial {
				return
			}
			// Echo for now
			text := "dcbot is running. Commands coming soon."
			_, _ = bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &text})
		})
	})

	if err := cli.Start(); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 4: Fetch dependencies**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go mod tidy
```

- [ ] **Step 5: Verify it builds**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go build ./cmd/dcbot/
```
Expected: no errors, `dcbot` binary created.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add go.mod go.sum cmd/dcbot/main.go .gitignore
git commit -m "feat: scaffold dcbot project with botcli skeleton"
```

---

### Task 2: Configuration (TOML + CLI Flags + Env Vars)

**Files:**
- Create: `internal/config/config.go`
- Create: `internal/config/config_test.go`
- Modify: `cmd/dcbot/main.go`

- [ ] **Step 1: Write failing test for config loading**

Create `internal/config/config_test.go`:
```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	content := `
[claude]
api_key = "sk-ant-test"
model = "claude-sonnet-4-6-20250514"
max_tokens = 4096
system_prompt = "You are helpful."

[bot]
data_dir = "/tmp/dcbot-data"
default_mode = "session"
session_timeout = "30m"
max_history_messages = 100
max_file_size = "10MB"
log_level = "info"

[owner]
email = "owner@example.com"
`
	os.WriteFile(path, []byte(content), 0644)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.Claude.APIKey != "sk-ant-test" {
		t.Errorf("APIKey = %q, want %q", cfg.Claude.APIKey, "sk-ant-test")
	}
	if cfg.Owner.Email != "owner@example.com" {
		t.Errorf("Owner.Email = %q, want %q", cfg.Owner.Email, "owner@example.com")
	}
	if cfg.Bot.DefaultMode != "session" {
		t.Errorf("DefaultMode = %q, want %q", cfg.Bot.DefaultMode, "session")
	}
}

func TestEnvVarOverridesConfigFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	content := `
[claude]
api_key = "from-file"

[owner]
email = "owner@example.com"
`
	os.WriteFile(path, []byte(content), 0644)

	t.Setenv("ANTHROPIC_API_KEY", "from-env")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	cfg.ApplyEnv()
	if cfg.Claude.APIKey != "from-env" {
		t.Errorf("APIKey = %q, want %q", cfg.Claude.APIKey, "from-env")
	}
}

func TestLoadMissingFileReturnsDefaults(t *testing.T) {
	cfg, err := Load("/nonexistent/config.toml")
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.Bot.DefaultMode != "session" {
		t.Errorf("DefaultMode = %q, want %q", cfg.Bot.DefaultMode, "session")
	}
	if cfg.Bot.SessionTimeout != "30m" {
		t.Errorf("SessionTimeout = %q, want %q", cfg.Bot.SessionTimeout, "30m")
	}
	if cfg.Bot.MaxHistoryMessages != 100 {
		t.Errorf("MaxHistoryMessages = %d, want %d", cfg.Bot.MaxHistoryMessages, 100)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/config/ -v
```
Expected: FAIL (package doesn't exist yet)

- [ ] **Step 3: Implement config package**

Create `internal/config/config.go`:
```go
package config

import (
	"os"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Claude ClaudeConfig `toml:"claude"`
	Bot    BotConfig    `toml:"bot"`
	Owner  OwnerConfig  `toml:"owner"`
}

type ClaudeConfig struct {
	APIKey       string `toml:"api_key"`
	Model        string `toml:"model"`
	MaxTokens    int    `toml:"max_tokens"`
	SystemPrompt string `toml:"system_prompt"`
}

type BotConfig struct {
	DataDir            string `toml:"data_dir"`
	DefaultMode        string `toml:"default_mode"`
	SessionTimeout     string `toml:"session_timeout"`
	MaxHistoryMessages int    `toml:"max_history_messages"`
	MaxFileSize        string `toml:"max_file_size"`
	LogLevel           string `toml:"log_level"`
}

type OwnerConfig struct {
	Email string `toml:"email"`
}

func Defaults() *Config {
	return &Config{
		Claude: ClaudeConfig{
			Model:        "claude-sonnet-4-6-20250514",
			MaxTokens:    4096,
			SystemPrompt: "You are a helpful assistant.",
		},
		Bot: BotConfig{
			DataDir:            "~/.config/dcbot/data",
			DefaultMode:        "session",
			SessionTimeout:     "30m",
			MaxHistoryMessages: 100,
			MaxFileSize:        "10MB",
			LogLevel:           "info",
		},
	}
}

func Load(path string) (*Config, error) {
	cfg := Defaults()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}
	if err := toml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) ApplyEnv() {
	if v := os.Getenv("ANTHROPIC_API_KEY"); v != "" {
		c.Claude.APIKey = v
	}
}
```

- [ ] **Step 4: Fetch dependency and run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go mod tidy
go test ./internal/config/ -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/config/ go.mod go.sum
git commit -m "feat: add config package with TOML parsing and env var support"
```

---

### Task 3: SQLite Store (Schema, Migrations, User/Group CRUD)

**Files:**
- Create: `internal/store/store.go`
- Create: `internal/store/store_test.go`

- [ ] **Step 1: Write failing tests for store**

Create `internal/store/store_test.go`:
```go
package store

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestUserCRUD(t *testing.T) {
	s := newTestStore(t)

	// Create pending user
	err := s.EnsureUser("alice@example.com")
	if err != nil {
		t.Fatalf("EnsureUser() error: %v", err)
	}

	u, err := s.GetUser("alice@example.com")
	if err != nil {
		t.Fatalf("GetUser() error: %v", err)
	}
	if u.Status != "pending" {
		t.Errorf("Status = %q, want %q", u.Status, "pending")
	}

	// Approve
	err = s.SetUserStatus("alice@example.com", "approved")
	if err != nil {
		t.Fatalf("SetUserStatus() error: %v", err)
	}
	u, _ = s.GetUser("alice@example.com")
	if u.Status != "approved" {
		t.Errorf("Status = %q, want %q", u.Status, "approved")
	}

	// Block
	err = s.SetUserStatus("alice@example.com", "blocked")
	if err != nil {
		t.Fatalf("SetUserStatus() error: %v", err)
	}
	u, _ = s.GetUser("alice@example.com")
	if u.Status != "blocked" {
		t.Errorf("Status = %q, want %q", u.Status, "blocked")
	}
}

func TestGetUserNotFound(t *testing.T) {
	s := newTestStore(t)
	u, err := s.GetUser("nobody@example.com")
	if err != nil {
		t.Fatalf("GetUser() error: %v", err)
	}
	if u != nil {
		t.Errorf("expected nil, got %+v", u)
	}
}

func TestUserMode(t *testing.T) {
	s := newTestStore(t)
	s.EnsureUser("alice@example.com")

	err := s.SetUserMode("alice@example.com", "persistent")
	if err != nil {
		t.Fatalf("SetUserMode() error: %v", err)
	}
	u, _ := s.GetUser("alice@example.com")
	if u.Mode == nil || *u.Mode != "persistent" {
		t.Errorf("Mode = %v, want %q", u.Mode, "persistent")
	}
}

func TestListUsers(t *testing.T) {
	s := newTestStore(t)
	s.EnsureUser("alice@example.com")
	s.EnsureUser("bob@example.com")
	s.SetUserStatus("alice@example.com", "approved")

	users, err := s.ListUsers()
	if err != nil {
		t.Fatalf("ListUsers() error: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("len(users) = %d, want 2", len(users))
	}
}

func TestGroupCRUD(t *testing.T) {
	s := newTestStore(t)

	err := s.EnsureGroup(42, "Book Club", "alice@example.com")
	if err != nil {
		t.Fatalf("EnsureGroup() error: %v", err)
	}

	g, err := s.GetGroup(42)
	if err != nil {
		t.Fatalf("GetGroup() error: %v", err)
	}
	if g.Status != "pending" {
		t.Errorf("Status = %q, want %q", g.Status, "pending")
	}
	if g.Name != "Book Club" {
		t.Errorf("Name = %q, want %q", g.Name, "Book Club")
	}

	err = s.SetGroupStatus(42, "approved")
	if err != nil {
		t.Fatalf("SetGroupStatus() error: %v", err)
	}
	g, _ = s.GetGroup(42)
	if g.Status != "approved" {
		t.Errorf("Status = %q, want %q", g.Status, "approved")
	}
}

func TestMessageHistory(t *testing.T) {
	s := newTestStore(t)

	err := s.AddMessage("user:alice@example.com", "user", "Hello")
	if err != nil {
		t.Fatalf("AddMessage() error: %v", err)
	}
	err = s.AddMessage("user:alice@example.com", "assistant", "Hi there!")
	if err != nil {
		t.Fatalf("AddMessage() error: %v", err)
	}

	msgs, err := s.GetMessages("user:alice@example.com", 100)
	if err != nil {
		t.Fatalf("GetMessages() error: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("len(msgs) = %d, want 2", len(msgs))
	}
	if msgs[0].Role != "user" || msgs[0].Content != "Hello" {
		t.Errorf("msgs[0] = %+v", msgs[0])
	}
	if msgs[1].Role != "assistant" || msgs[1].Content != "Hi there!" {
		t.Errorf("msgs[1] = %+v", msgs[1])
	}
}

func TestClearMessages(t *testing.T) {
	s := newTestStore(t)
	s.AddMessage("user:alice@example.com", "user", "Hello")
	s.AddMessage("user:alice@example.com", "assistant", "Hi")

	err := s.ClearMessages("user:alice@example.com")
	if err != nil {
		t.Fatalf("ClearMessages() error: %v", err)
	}

	msgs, _ := s.GetMessages("user:alice@example.com", 100)
	if len(msgs) != 0 {
		t.Errorf("len(msgs) = %d, want 0", len(msgs))
	}
}

func TestGetMessagesLimit(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 10; i++ {
		s.AddMessage("user:alice@example.com", "user", "msg")
	}

	msgs, _ := s.GetMessages("user:alice@example.com", 3)
	if len(msgs) != 3 {
		t.Fatalf("len(msgs) = %d, want 3", len(msgs))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/store/ -v
```
Expected: FAIL

- [ ] **Step 3: Implement store package**

Create `internal/store/store.go`:
```go
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type User struct {
	Email  string
	Status string
	Mode   *string
}

type Group struct {
	GroupID int64
	Name    string
	Status  string
	Mode    *string
	AddedBy string
}

type Message struct {
	Role    string
	Content string
}

const schemaVersion = 1

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	var version int
	err := s.db.QueryRow("PRAGMA user_version").Scan(&version)
	if err != nil {
		return err
	}
	if version >= schemaVersion {
		return nil
	}
	if version < 1 {
		_, err := s.db.Exec(`
			CREATE TABLE IF NOT EXISTS users (
				email      TEXT PRIMARY KEY,
				status     TEXT NOT NULL DEFAULT 'pending',
				mode       TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE TABLE IF NOT EXISTS groups (
				group_id   INTEGER PRIMARY KEY,
				name       TEXT,
				status     TEXT NOT NULL DEFAULT 'pending',
				mode       TEXT,
				added_by   TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE TABLE IF NOT EXISTS messages (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				chat_id    TEXT NOT NULL,
				role       TEXT NOT NULL,
				content    TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, created_at);
		`)
		if err != nil {
			return err
		}
	}
	_, err = s.db.Exec(fmt.Sprintf("PRAGMA user_version = %d", schemaVersion))
	return err
}

func (s *Store) EnsureUser(email string) error {
	_, err := s.db.Exec(
		"INSERT OR IGNORE INTO users (email) VALUES (?)", email)
	return err
}

func (s *Store) GetUser(email string) (*User, error) {
	row := s.db.QueryRow("SELECT email, status, mode FROM users WHERE email = ?", email)
	u := &User{}
	err := row.Scan(&u.Email, &u.Status, &u.Mode)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Store) SetUserStatus(email, status string) error {
	_, err := s.db.Exec(
		"UPDATE users SET status = ?, updated_at = datetime('now') WHERE email = ?",
		status, email)
	return err
}

func (s *Store) SetUserMode(email, mode string) error {
	_, err := s.db.Exec(
		"UPDATE users SET mode = ?, updated_at = datetime('now') WHERE email = ?",
		mode, email)
	return err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query("SELECT email, status, mode FROM users ORDER BY email")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.Email, &u.Status, &u.Mode); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (s *Store) EnsureGroup(groupID int64, name, addedBy string) error {
	_, err := s.db.Exec(
		"INSERT OR IGNORE INTO groups (group_id, name, added_by) VALUES (?, ?, ?)",
		groupID, name, addedBy)
	return err
}

func (s *Store) GetGroup(groupID int64) (*Group, error) {
	row := s.db.QueryRow(
		"SELECT group_id, name, status, mode, added_by FROM groups WHERE group_id = ?",
		groupID)
	g := &Group{}
	err := row.Scan(&g.GroupID, &g.Name, &g.Status, &g.Mode, &g.AddedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return g, nil
}

func (s *Store) SetGroupStatus(groupID int64, status string) error {
	_, err := s.db.Exec(
		"UPDATE groups SET status = ? WHERE group_id = ?", status, groupID)
	return err
}

func (s *Store) SetGroupMode(groupID int64, mode string) error {
	_, err := s.db.Exec(
		"UPDATE groups SET mode = ? WHERE group_id = ?", mode, groupID)
	return err
}

func (s *Store) AddMessage(chatID, role, content string) error {
	_, err := s.db.Exec(
		"INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)",
		chatID, role, content)
	return err
}

func (s *Store) GetMessages(chatID string, limit int) ([]Message, error) {
	rows, err := s.db.Query(`
		SELECT role, content FROM (
			SELECT role, content, created_at FROM messages
			WHERE chat_id = ?
			ORDER BY created_at DESC, id DESC
			LIMIT ?
		) sub ORDER BY created_at ASC, rowid ASC`,
		chatID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.Role, &m.Content); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

func (s *Store) ClearMessages(chatID string) error {
	_, err := s.db.Exec("DELETE FROM messages WHERE chat_id = ?", chatID)
	return err
}
```

- [ ] **Step 4: Fetch dependency and run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go mod tidy
go test ./internal/store/ -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/store/ go.mod go.sum
git commit -m "feat: add SQLite store with user, group, and message CRUD"
```

---

### Task 4: Claude API Client (Streaming + Vision)

**Files:**
- Create: `internal/claude/client.go`
- Create: `internal/claude/client_test.go`

- [ ] **Step 1: Write failing tests for Claude client**

Create `internal/claude/client_test.go`:
```go
package claude

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSendMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-key" {
			t.Errorf("missing api key header")
		}
		if r.Header.Get("anthropic-version") == "" {
			t.Errorf("missing anthropic-version header")
		}

		var req Request
		json.NewDecoder(r.Body).Decode(&req)

		if req.Model != "claude-sonnet-4-6-20250514" {
			t.Errorf("Model = %q", req.Model)
		}
		if req.System != "Be helpful." {
			t.Errorf("System = %q", req.System)
		}
		if len(req.Messages) != 1 {
			t.Fatalf("len(Messages) = %d, want 1", len(req.Messages))
		}

		resp := Response{
			Content: []ContentBlock{{Type: "text", Text: "Hello back!"}},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := NewClient("test-key", "claude-sonnet-4-6-20250514", 4096, server.URL)
	msgs := []ChatMessage{{Role: "user", Content: "Hello"}}
	resp, err := c.Send("Be helpful.", msgs)
	if err != nil {
		t.Fatalf("Send() error: %v", err)
	}
	if resp != "Hello back!" {
		t.Errorf("resp = %q, want %q", resp, "Hello back!")
	}
}

func TestSendMessageWithImage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req Request
		json.NewDecoder(r.Body).Decode(&req)

		// Should have a message with multi-part content
		if len(req.Messages) != 1 {
			t.Fatalf("len(Messages) = %d, want 1", len(req.Messages))
		}

		resp := Response{
			Content: []ContentBlock{{Type: "text", Text: "I see an image."}},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	c := NewClient("test-key", "claude-sonnet-4-6-20250514", 4096, server.URL)
	msgs := []ChatMessage{
		{
			Role:    "user",
			Content: "What's in this image?",
			Media: []MediaAttachment{
				{Type: "image", MimeType: "image/jpeg", Data: "base64data"},
			},
		},
	}
	resp, err := c.Send("Be helpful.", msgs)
	if err != nil {
		t.Fatalf("Send() error: %v", err)
	}
	if resp != "I see an image." {
		t.Errorf("resp = %q", resp)
	}
}

func TestSendMessageAPIError(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.WriteHeader(http.StatusTooManyRequests)
		fmt.Fprint(w, `{"error":{"type":"rate_limit_error","message":"rate limited"}}`)
	}))
	defer server.Close()

	c := NewClient("test-key", "claude-sonnet-4-6-20250514", 4096, server.URL)
	msgs := []ChatMessage{{Role: "user", Content: "Hello"}}
	_, err := c.Send("Be helpful.", msgs)
	if err == nil {
		t.Fatal("expected error")
	}
	// Should have retried 3 times + 1 original = 4 total
	if attempts != 4 {
		t.Errorf("attempts = %d, want 4", attempts)
	}
}

func TestSendMessageAuthError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":{"type":"authentication_error","message":"invalid key"}}`)
	}))
	defer server.Close()

	c := NewClient("bad-key", "claude-sonnet-4-6-20250514", 4096, server.URL)
	msgs := []ChatMessage{{Role: "user", Content: "Hello"}}
	_, err := c.Send("Be helpful.", msgs)
	if err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/claude/ -v
```
Expected: FAIL

- [ ] **Step 3: Implement Claude client**

Create `internal/claude/client.go`:
```go
package claude

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultBaseURL = "https://api.anthropic.com/v1/messages"

type Client struct {
	apiKey    string
	model     string
	maxTokens int
	baseURL   string
	http      *http.Client
}

type ChatMessage struct {
	Role    string
	Content string
	Media   []MediaAttachment
}

type MediaAttachment struct {
	Type     string // "image" or "document"
	MimeType string
	Data     string // base64
}

// API request/response types

type Request struct {
	Model     string       `json:"model"`
	MaxTokens int          `json:"max_tokens"`
	System    string       `json:"system,omitempty"`
	Messages  []apiMessage `json:"messages"`
}

type apiMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type textContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type imageContent struct {
	Type   string      `json:"type"`
	Source imageSource `json:"source"`
}

type imageSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type documentContent struct {
	Type   string         `json:"type"`
	Source documentSource `json:"source"`
}

type documentSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type Response struct {
	Content []ContentBlock `json:"content"`
	Error   *APIError      `json:"error,omitempty"`
}

type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type APIError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func NewClient(apiKey, model string, maxTokens int, baseURL string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		apiKey:    apiKey,
		model:     model,
		maxTokens: maxTokens,
		baseURL:   baseURL,
		http:      &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *Client) Send(systemPrompt string, messages []ChatMessage) (string, error) {
	apiMsgs := make([]apiMessage, 0, len(messages))
	for _, m := range messages {
		if len(m.Media) == 0 {
			apiMsgs = append(apiMsgs, apiMessage{Role: m.Role, Content: m.Content})
		} else {
			parts := make([]interface{}, 0)
			for _, media := range m.Media {
				switch media.Type {
				case "image":
					parts = append(parts, imageContent{
						Type: "image",
						Source: imageSource{
							Type:      "base64",
							MediaType: media.MimeType,
							Data:      media.Data,
						},
					})
				case "document":
					parts = append(parts, documentContent{
						Type: "document",
						Source: documentSource{
							Type:      "base64",
							MediaType: media.MimeType,
							Data:      media.Data,
						},
					})
				}
			}
			if m.Content != "" {
				parts = append(parts, textContent{Type: "text", Text: m.Content})
			}
			apiMsgs = append(apiMsgs, apiMessage{Role: m.Role, Content: parts})
		}
	}

	req := Request{
		Model:     c.model,
		MaxTokens: c.maxTokens,
		System:    systemPrompt,
		Messages:  apiMsgs,
	}

	return c.doRequest(req, 3)
}

func (c *Client) doRequest(req Request, retriesLeft int) (string, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.baseURL, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		if retriesLeft > 0 {
			delay := time.Duration(4-retriesLeft) * time.Second
			time.Sleep(delay)
			return c.doRequest(req, retriesLeft-1)
		}
		return "", fmt.Errorf("rate limited after retries")
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return "", fmt.Errorf("authentication error: invalid API key")
	}

	if resp.StatusCode >= 500 {
		if retriesLeft > 0 {
			time.Sleep(time.Second)
			return c.doRequest(req, retriesLeft-1)
		}
		return "", fmt.Errorf("server error: %s", string(respBody))
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var apiResp Response
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	var sb strings.Builder
	for _, block := range apiResp.Content {
		if block.Type == "text" {
			sb.WriteString(block.Text)
		}
	}
	return sb.String(), nil
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/claude/ -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/claude/
git commit -m "feat: add Claude API client with retry logic and vision support"
```

---

### Task 5: Session Manager (In-Memory History with Timeout)

**Files:**
- Create: `internal/session/session.go`
- Create: `internal/session/session_test.go`

- [ ] **Step 1: Write failing tests**

Create `internal/session/session_test.go`:
```go
package session

import (
	"testing"
	"time"

	"github.com/jhayashi/dcbot/internal/claude"
)

func TestAddAndGet(t *testing.T) {
	mgr := New(30 * time.Minute)
	mgr.Add("chat1", claude.ChatMessage{Role: "user", Content: "Hello"})
	mgr.Add("chat1", claude.ChatMessage{Role: "assistant", Content: "Hi!"})

	msgs := mgr.Get("chat1", 100)
	if len(msgs) != 2 {
		t.Fatalf("len(msgs) = %d, want 2", len(msgs))
	}
	if msgs[0].Content != "Hello" {
		t.Errorf("msgs[0].Content = %q", msgs[0].Content)
	}
}

func TestGetEmpty(t *testing.T) {
	mgr := New(30 * time.Minute)
	msgs := mgr.Get("nonexistent", 100)
	if len(msgs) != 0 {
		t.Errorf("len(msgs) = %d, want 0", len(msgs))
	}
}

func TestGetWithLimit(t *testing.T) {
	mgr := New(30 * time.Minute)
	for i := 0; i < 10; i++ {
		mgr.Add("chat1", claude.ChatMessage{Role: "user", Content: "msg"})
	}

	msgs := mgr.Get("chat1", 3)
	if len(msgs) != 3 {
		t.Fatalf("len(msgs) = %d, want 3", len(msgs))
	}
}

func TestClear(t *testing.T) {
	mgr := New(30 * time.Minute)
	mgr.Add("chat1", claude.ChatMessage{Role: "user", Content: "Hello"})
	mgr.Clear("chat1")

	msgs := mgr.Get("chat1", 100)
	if len(msgs) != 0 {
		t.Errorf("len(msgs) = %d, want 0", len(msgs))
	}
}

func TestExpiry(t *testing.T) {
	mgr := New(50 * time.Millisecond)
	mgr.Add("chat1", claude.ChatMessage{Role: "user", Content: "Hello"})

	time.Sleep(100 * time.Millisecond)

	msgs := mgr.Get("chat1", 100)
	if len(msgs) != 0 {
		t.Errorf("len(msgs) = %d, want 0 (should have expired)", len(msgs))
	}
}

func TestTouchResetsTimer(t *testing.T) {
	mgr := New(100 * time.Millisecond)
	mgr.Add("chat1", claude.ChatMessage{Role: "user", Content: "Hello"})

	time.Sleep(60 * time.Millisecond)
	mgr.Touch("chat1")
	time.Sleep(60 * time.Millisecond)

	msgs := mgr.Get("chat1", 100)
	if len(msgs) != 1 {
		t.Errorf("len(msgs) = %d, want 1 (touch should have reset timer)", len(msgs))
	}
}

func TestCount(t *testing.T) {
	mgr := New(30 * time.Minute)
	mgr.Add("chat1", claude.ChatMessage{Role: "user", Content: "Hello"})
	mgr.Add("chat1", claude.ChatMessage{Role: "assistant", Content: "Hi"})

	if n := mgr.Count("chat1"); n != 2 {
		t.Errorf("Count = %d, want 2", n)
	}
	if n := mgr.Count("nonexistent"); n != 0 {
		t.Errorf("Count = %d, want 0", n)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/session/ -v
```
Expected: FAIL

- [ ] **Step 3: Implement session manager**

Create `internal/session/session.go`:
```go
package session

import (
	"sync"
	"time"

	"github.com/jhayashi/dcbot/internal/claude"
)

type session struct {
	messages []claude.ChatMessage
	lastUsed time.Time
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
	timeout  time.Duration
}

func New(timeout time.Duration) *Manager {
	return &Manager{
		sessions: make(map[string]*session),
		timeout:  timeout,
	}
}

func (m *Manager) Add(chatID string, msg claude.ChatMessage) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[chatID]
	if !ok || time.Since(s.lastUsed) > m.timeout {
		s = &session{}
		m.sessions[chatID] = s
	}
	s.messages = append(s.messages, msg)
	s.lastUsed = time.Now()
}

func (m *Manager) Get(chatID string, limit int) []claude.ChatMessage {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[chatID]
	if !ok {
		return nil
	}
	if time.Since(s.lastUsed) > m.timeout {
		delete(m.sessions, chatID)
		return nil
	}

	msgs := s.messages
	if len(msgs) > limit {
		msgs = msgs[len(msgs)-limit:]
	}
	result := make([]claude.ChatMessage, len(msgs))
	copy(result, msgs)
	return result
}

func (m *Manager) Touch(chatID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[chatID]; ok {
		s.lastUsed = time.Now()
	}
}

func (m *Manager) Clear(chatID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.sessions, chatID)
}

func (m *Manager) Count(chatID string) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.sessions[chatID]
	if !ok {
		return 0
	}
	if time.Since(s.lastUsed) > m.timeout {
		delete(m.sessions, chatID)
		return 0
	}
	return len(s.messages)
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/session/ -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/session/
git commit -m "feat: add in-memory session manager with timeout"
```

---

### Task 6: Media Handler (Image/PDF/Text Detection and Encoding)

**Files:**
- Create: `internal/media/media.go`
- Create: `internal/media/media_test.go`

- [ ] **Step 1: Write failing tests**

Create `internal/media/media_test.go`:
```go
package media

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClassifyMime(t *testing.T) {
	tests := []struct {
		mime string
		want FileType
	}{
		{"image/jpeg", TypeImage},
		{"image/png", TypeImage},
		{"image/webp", TypeImage},
		{"image/gif", TypeImage},
		{"application/pdf", TypeDocument},
		{"text/plain", TypeText},
		{"text/csv", TypeText},
		{"application/octet-stream", TypeUnsupported},
		{"audio/mpeg", TypeUnsupported},
		{"video/mp4", TypeUnsupported},
	}
	for _, tt := range tests {
		got := Classify(tt.mime)
		if got != tt.want {
			t.Errorf("Classify(%q) = %v, want %v", tt.mime, got, tt.want)
		}
	}
}

func TestEncodeImageFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.jpg")
	os.WriteFile(path, []byte("fake-jpeg-data"), 0644)

	att, err := Encode(path, "image/jpeg", 10*1024*1024)
	if err != nil {
		t.Fatalf("Encode() error: %v", err)
	}
	if att.Type != "image" {
		t.Errorf("Type = %q, want %q", att.Type, "image")
	}
	if att.MimeType != "image/jpeg" {
		t.Errorf("MimeType = %q", att.MimeType)
	}
	if att.Data == "" {
		t.Error("Data is empty")
	}
}

func TestEncodeTextFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	os.WriteFile(path, []byte("Hello, world!"), 0644)

	att, err := Encode(path, "text/plain", 10*1024*1024)
	if err != nil {
		t.Fatalf("Encode() error: %v", err)
	}
	if att.Type != "text" {
		t.Errorf("Type = %q, want %q", att.Type, "text")
	}
	if att.Text != "Hello, world!" {
		t.Errorf("Text = %q", att.Text)
	}
}

func TestEncodePDFFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.pdf")
	os.WriteFile(path, []byte("fake-pdf-data"), 0644)

	att, err := Encode(path, "application/pdf", 10*1024*1024)
	if err != nil {
		t.Fatalf("Encode() error: %v", err)
	}
	if att.Type != "document" {
		t.Errorf("Type = %q, want %q", att.Type, "document")
	}
	if att.MimeType != "application/pdf" {
		t.Errorf("MimeType = %q", att.MimeType)
	}
}

func TestEncodeFileTooLarge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "big.jpg")
	os.WriteFile(path, make([]byte, 100), 0644)

	_, err := Encode(path, "image/jpeg", 50) // max 50 bytes
	if err == nil {
		t.Fatal("expected error for oversized file")
	}
}

func TestEncodeUnsupportedType(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "song.mp3")
	os.WriteFile(path, []byte("fake"), 0644)

	_, err := Encode(path, "audio/mpeg", 10*1024*1024)
	if err == nil {
		t.Fatal("expected error for unsupported type")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/media/ -v
```
Expected: FAIL

- [ ] **Step 3: Implement media package**

Create `internal/media/media.go`:
```go
package media

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

type FileType int

const (
	TypeImage FileType = iota
	TypeDocument
	TypeText
	TypeUnsupported
)

type Attachment struct {
	Type     string // "image", "document", "text"
	MimeType string
	Data     string // base64 for image/document
	Text     string // plain text content for text files
}

func Classify(mime string) FileType {
	if strings.HasPrefix(mime, "image/") {
		return TypeImage
	}
	if mime == "application/pdf" {
		return TypeDocument
	}
	if strings.HasPrefix(mime, "text/") {
		return TypeText
	}
	return TypeUnsupported
}

func Encode(path, mime string, maxBytes int64) (*Attachment, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat file: %w", err)
	}
	if info.Size() > maxBytes {
		return nil, fmt.Errorf("file too large: %d bytes (max %d)", info.Size(), maxBytes)
	}

	ft := Classify(mime)
	if ft == TypeUnsupported {
		return nil, fmt.Errorf("unsupported file type: %s", mime)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	switch ft {
	case TypeImage:
		return &Attachment{
			Type:     "image",
			MimeType: mime,
			Data:     base64.StdEncoding.EncodeToString(data),
		}, nil
	case TypeDocument:
		return &Attachment{
			Type:     "document",
			MimeType: mime,
			Data:     base64.StdEncoding.EncodeToString(data),
		}, nil
	case TypeText:
		return &Attachment{
			Type: "text",
			Text: string(data),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported file type: %s", mime)
	}
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/media/ -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/media/
git commit -m "feat: add media handler for image, PDF, and text file encoding"
```

---

### Task 7: Bot Command Dispatcher

**Files:**
- Create: `internal/bot/commands.go`
- Create: `internal/bot/commands_test.go`

- [ ] **Step 1: Write failing tests**

Create `internal/bot/commands_test.go`:
```go
package bot

import (
	"testing"
)

func TestParseCommand(t *testing.T) {
	tests := []struct {
		input string
		cmd   string
		args  string
		isCmd bool
	}{
		{"/help", "help", "", true},
		{"/mode persistent", "mode", "persistent", true},
		{"/approve alice@example.com", "approve", "alice@example.com", true},
		{"/approve-group 42", "approve-group", "42", true},
		{"hello", "", "", false},
		{"", "", "", false},
		{"/", "", "", false},
	}
	for _, tt := range tests {
		cmd, args, isCmd := ParseCommand(tt.input)
		if isCmd != tt.isCmd {
			t.Errorf("ParseCommand(%q) isCmd = %v, want %v", tt.input, isCmd, tt.isCmd)
		}
		if cmd != tt.cmd {
			t.Errorf("ParseCommand(%q) cmd = %q, want %q", tt.input, cmd, tt.cmd)
		}
		if args != tt.args {
			t.Errorf("ParseCommand(%q) args = %q, want %q", tt.input, args, tt.args)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/bot/ -v
```
Expected: FAIL

- [ ] **Step 3: Implement command parser**

Create `internal/bot/commands.go`:
```go
package bot

import "strings"

func ParseCommand(text string) (cmd, args string, isCmd bool) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "/") || len(text) < 2 {
		return "", "", false
	}
	text = text[1:] // strip leading /
	parts := strings.SplitN(text, " ", 2)
	cmd = parts[0]
	if len(parts) > 1 {
		args = strings.TrimSpace(parts[1])
	}
	return cmd, args, true
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/bot/ -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/bot/
git commit -m "feat: add command parser for bot chat commands"
```

---

### Task 8: Core Bot Logic (Message Handler + Wiring)

**Files:**
- Create: `internal/bot/bot.go`
- Modify: `cmd/dcbot/main.go`

This task wires everything together: the message handler that checks access control, dispatches commands, loads history, calls Claude, and sends the response.

- [ ] **Step 1: Create bot.go with Bot struct and handler**

Create `internal/bot/bot.go`:
```go
package bot

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chatmail/rpc-client-go/v2/deltachat"
	"github.com/jhayashi/dcbot/internal/claude"
	"github.com/jhayashi/dcbot/internal/config"
	"github.com/jhayashi/dcbot/internal/media"
	"github.com/jhayashi/dcbot/internal/session"
	"github.com/jhayashi/dcbot/internal/store"
)

type Bot struct {
	cfg      *config.Config
	store    *store.Store
	sessions *session.Manager
	claude   *claude.Client
	logger   *slog.Logger

	chatMu   sync.Map // map[string]*sync.Mutex — per-chat lock
}

func New(cfg *config.Config, st *store.Store, cl *claude.Client, logger *slog.Logger) *Bot {
	timeout, err := time.ParseDuration(cfg.Bot.SessionTimeout)
	if err != nil {
		timeout = 30 * time.Minute
	}
	return &Bot{
		cfg:      cfg,
		store:    st,
		sessions: session.New(timeout),
		claude:   cl,
		logger:   logger,
	}
}

func (b *Bot) chatLock(chatID string) *sync.Mutex {
	mu, _ := b.chatMu.LoadOrStore(chatID, &sync.Mutex{})
	return mu.(*sync.Mutex)
}

func (b *Bot) HandleMessage(bot *deltachat.Bot, accId uint32, msgId uint32) {
	msg, err := bot.Rpc.GetMessage(accId, msgId)
	if err != nil {
		b.logger.Error("get message", "err", err)
		return
	}
	if msg.FromId <= deltachat.ContactLastSpecial {
		return
	}

	chat, err := bot.Rpc.GetFullChatById(accId, msg.ChatId)
	if err != nil {
		b.logger.Error("get chat", "err", err)
		return
	}

	// Accept contact requests automatically
	if chat.IsContactRequest {
		bot.Rpc.AcceptChat(accId, msg.ChatId)
	}

	senderEmail := msg.Sender.Address
	isGroup := chat.ChatType == "Group"
	chatID := b.chatIDKey(senderEmail, isGroup, msg.ChatId)

	// Per-chat sequential processing
	lock := b.chatLock(chatID)
	lock.Lock()
	defer lock.Unlock()

	// Check access control
	allowed, err := b.checkAccess(bot, accId, msg, chat, senderEmail, isGroup)
	if err != nil {
		b.logger.Error("check access", "err", err)
		return
	}
	if !allowed {
		return
	}

	// Check for commands
	if cmd, args, isCmd := ParseCommand(msg.Text); isCmd {
		b.handleCommand(bot, accId, msg, chat, senderEmail, isGroup, cmd, args)
		return
	}

	// Build Claude message with optional media
	chatMsg, err := b.buildChatMessage(bot, accId, msg)
	if err != nil {
		b.logger.Error("build chat message", "err", err)
		text := fmt.Sprintf("Error processing your message: %s", err.Error())
		bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &text})
		return
	}

	// Get mode for this chat
	mode := b.getMode(senderEmail, isGroup, msg.ChatId)

	// Load history
	history := b.loadHistory(chatID, mode)

	// Add current message to history
	allMsgs := append(history, *chatMsg)

	// Call Claude
	resp, err := b.claude.Send(b.cfg.Claude.SystemPrompt, allMsgs)
	if err != nil {
		b.logger.Error("claude send", "err", err)
		text := b.errorMessage(err)
		bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &text})
		return
	}

	// Store messages in history
	b.saveToHistory(chatID, mode, *chatMsg, claude.ChatMessage{Role: "assistant", Content: resp})

	// Send response
	bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &resp})
}

func (b *Bot) chatIDKey(email string, isGroup bool, chatId uint32) string {
	if isGroup {
		return fmt.Sprintf("group:%d", chatId)
	}
	return fmt.Sprintf("user:%s", email)
}

func (b *Bot) checkAccess(bot *deltachat.Bot, accId uint32, msg *deltachat.Message, chat *deltachat.FullChat, senderEmail string, isGroup bool) (bool, error) {
	// Owner always has access
	if senderEmail == b.cfg.Owner.Email {
		b.store.EnsureUser(senderEmail)
		b.store.SetUserStatus(senderEmail, "approved")
		return true, nil
	}

	if isGroup {
		return b.checkGroupAccess(bot, accId, msg, chat, senderEmail)
	}

	return b.checkUserAccess(bot, accId, msg, senderEmail)
}

func (b *Bot) checkUserAccess(bot *deltachat.Bot, accId uint32, msg *deltachat.Message, senderEmail string) (bool, error) {
	b.store.EnsureUser(senderEmail)
	u, err := b.store.GetUser(senderEmail)
	if err != nil {
		return false, err
	}

	switch u.Status {
	case "approved":
		return true, nil
	case "blocked":
		return false, nil // silent ignore
	case "pending":
		// Notify user
		text := "Access requested. Waiting for approval."
		bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &text})
		// Notify owner
		b.notifyOwner(bot, accId, fmt.Sprintf("New access request from %s", senderEmail))
		return false, nil
	}
	return false, nil
}

func (b *Bot) checkGroupAccess(bot *deltachat.Bot, accId uint32, msg *deltachat.Message, chat *deltachat.FullChat, senderEmail string) (bool, error) {
	groupID := int64(msg.ChatId)
	b.store.EnsureGroup(groupID, chat.Name, senderEmail)

	g, err := b.store.GetGroup(groupID)
	if err != nil {
		return false, err
	}

	switch g.Status {
	case "approved":
		return true, nil
	case "pending":
		text := "This group is pending approval."
		bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &text})
		b.notifyOwner(bot, accId, fmt.Sprintf("New group access request: '%s' (id: %d)", chat.Name, msg.ChatId))
		return false, nil
	}
	return false, nil
}

func (b *Bot) notifyOwner(bot *deltachat.Bot, accId uint32, text string) {
	if b.cfg.Owner.Email == "" {
		return
	}
	contactId, err := bot.Rpc.LookupContactIdByAddr(accId, b.cfg.Owner.Email)
	if err != nil || contactId == nil {
		b.logger.Warn("owner contact not found", "email", b.cfg.Owner.Email)
		return
	}
	chatId, err := bot.Rpc.CreateChatByContactId(accId, *contactId)
	if err != nil {
		b.logger.Error("create owner chat", "err", err)
		return
	}
	bot.Rpc.SendMsg(accId, chatId, deltachat.MessageData{Text: &text})
}

func (b *Bot) buildChatMessage(bot *deltachat.Bot, accId uint32, msg *deltachat.Message) (*claude.ChatMessage, error) {
	chatMsg := &claude.ChatMessage{
		Role:    "user",
		Content: msg.Text,
	}

	if msg.File != nil && *msg.File != "" {
		mime := ""
		if msg.FileMime != nil {
			mime = *msg.FileMime
		}
		maxSize := parseFileSize(b.cfg.Bot.MaxFileSize)
		att, err := media.Encode(*msg.File, mime, maxSize)
		if err != nil {
			return nil, err
		}

		switch att.Type {
		case "image", "document":
			chatMsg.Media = append(chatMsg.Media, claude.MediaAttachment{
				Type:     att.Type,
				MimeType: att.MimeType,
				Data:     att.Data,
			})
		case "text":
			if chatMsg.Content != "" {
				chatMsg.Content += "\n\n"
			}
			chatMsg.Content += fmt.Sprintf("File contents (%s):\n%s", msg.FileName, att.Text)
		}
	}

	return chatMsg, nil
}

func (b *Bot) getMode(email string, isGroup bool, chatId uint32) string {
	if isGroup {
		g, _ := b.store.GetGroup(int64(chatId))
		if g != nil && g.Mode != nil {
			return *g.Mode
		}
		return b.cfg.Bot.DefaultMode
	}
	u, _ := b.store.GetUser(email)
	if u != nil && u.Mode != nil {
		return *u.Mode
	}
	return b.cfg.Bot.DefaultMode
}

func (b *Bot) loadHistory(chatID, mode string) []claude.ChatMessage {
	switch mode {
	case "ephemeral":
		return nil
	case "session":
		return b.sessions.Get(chatID, b.cfg.Bot.MaxHistoryMessages)
	case "persistent":
		msgs, err := b.store.GetMessages(chatID, b.cfg.Bot.MaxHistoryMessages)
		if err != nil {
			b.logger.Error("load history", "err", err)
			return nil
		}
		result := make([]claude.ChatMessage, len(msgs))
		for i, m := range msgs {
			result[i] = claude.ChatMessage{Role: m.Role, Content: m.Content}
		}
		return result
	}
	return nil
}

func (b *Bot) saveToHistory(chatID, mode string, msgs ...claude.ChatMessage) {
	switch mode {
	case "session":
		for _, m := range msgs {
			b.sessions.Add(chatID, m)
		}
	case "persistent":
		for _, m := range msgs {
			b.store.AddMessage(chatID, m.Role, m.Content)
		}
	}
}

func (b *Bot) handleCommand(bot *deltachat.Bot, accId uint32, msg *deltachat.Message, chat *deltachat.FullChat, senderEmail string, isGroup bool, cmd, args string) {
	var reply string

	switch cmd {
	case "help":
		reply = b.helpText(senderEmail)
	case "mode":
		reply = b.cmdMode(senderEmail, isGroup, msg.ChatId, chat, args)
	case "clear":
		chatID := b.chatIDKey(senderEmail, isGroup, msg.ChatId)
		b.sessions.Clear(chatID)
		b.store.ClearMessages(chatID)
		reply = "Conversation history cleared."
	case "status":
		reply = b.cmdStatus(senderEmail, isGroup, msg.ChatId)
	// Owner commands
	case "approve":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdApprove(args) })
	case "deny":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdDeny(args) })
	case "revoke":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdRevoke(args) })
	case "users":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdUsers() })
	case "approve-group":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdApproveGroup(args) })
	case "deny-group":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdDenyGroup(args) })
	case "revoke-group":
		reply = b.ownerOnly(senderEmail, func() string { return b.cmdRevokeGroup(args) })
	default:
		reply = fmt.Sprintf("Unknown command: /%s. Use /help for available commands.", cmd)
	}

	bot.Rpc.SendMsg(accId, msg.ChatId, deltachat.MessageData{Text: &reply})
}

func (b *Bot) ownerOnly(senderEmail string, fn func() string) string {
	if senderEmail != b.cfg.Owner.Email {
		return "This command is only available to the bot owner."
	}
	return fn()
}

func (b *Bot) helpText(senderEmail string) string {
	text := `Available commands:
/help — Show this help
/mode <ephemeral|session|persistent> — Switch conversation mode
/clear — Clear conversation history
/status — Show current mode and message count`

	if senderEmail == b.cfg.Owner.Email {
		text += `

Owner commands:
/approve <email> — Approve a pending user
/deny <email> — Block a user
/revoke <email> — Remove user access
/users — List all users
/approve-group <id> — Approve a group
/deny-group <id> — Deny a group
/revoke-group <id> — Remove group access`
	}
	return text
}

func (b *Bot) cmdMode(senderEmail string, isGroup bool, chatId uint32, chat *deltachat.FullChat, args string) string {
	validModes := map[string]bool{"ephemeral": true, "session": true, "persistent": true}
	if !validModes[args] {
		return "Usage: /mode <ephemeral|session|persistent>"
	}

	if isGroup {
		g, _ := b.store.GetGroup(int64(chatId))
		if g != nil && senderEmail != b.cfg.Owner.Email && g.AddedBy != senderEmail {
			return "Only the bot owner or the member who added the bot can change the group mode."
		}
		b.store.SetGroupMode(int64(chatId), args)
	} else {
		b.store.SetUserMode(senderEmail, args)
	}
	return fmt.Sprintf("Conversation mode set to %s.", args)
}

func (b *Bot) cmdStatus(senderEmail string, isGroup bool, chatId uint32) string {
	chatID := b.chatIDKey(senderEmail, isGroup, chatId)
	mode := b.getMode(senderEmail, isGroup, chatId)

	var count int
	switch mode {
	case "session":
		count = b.sessions.Count(chatID)
	case "persistent":
		msgs, _ := b.store.GetMessages(chatID, 10000)
		count = len(msgs)
	}

	return fmt.Sprintf("Mode: %s\nMessages in history: %d", mode, count)
}

func (b *Bot) cmdApprove(email string) string {
	if email == "" {
		return "Usage: /approve <email>"
	}
	b.store.EnsureUser(email)
	b.store.SetUserStatus(email, "approved")
	return fmt.Sprintf("User %s approved.", email)
}

func (b *Bot) cmdDeny(email string) string {
	if email == "" {
		return "Usage: /deny <email>"
	}
	b.store.EnsureUser(email)
	b.store.SetUserStatus(email, "blocked")
	return fmt.Sprintf("User %s blocked.", email)
}

func (b *Bot) cmdRevoke(email string) string {
	if email == "" {
		return "Usage: /revoke <email>"
	}
	b.store.SetUserStatus(email, "pending")
	return fmt.Sprintf("User %s access revoked. They can re-request.", email)
}

func (b *Bot) cmdUsers() string {
	users, err := b.store.ListUsers()
	if err != nil {
		return fmt.Sprintf("Error: %v", err)
	}
	if len(users) == 0 {
		return "No users."
	}
	var sb strings.Builder
	for _, u := range users {
		sb.WriteString(fmt.Sprintf("%s — %s\n", u.Email, u.Status))
	}
	return sb.String()
}

func (b *Bot) cmdApproveGroup(args string) string {
	id, err := strconv.ParseInt(args, 10, 64)
	if err != nil {
		return "Usage: /approve-group <id>"
	}
	b.store.SetGroupStatus(id, "approved")
	return fmt.Sprintf("Group %d approved.", id)
}

func (b *Bot) cmdDenyGroup(args string) string {
	id, err := strconv.ParseInt(args, 10, 64)
	if err != nil {
		return "Usage: /deny-group <id>"
	}
	b.store.SetGroupStatus(id, "denied")
	return fmt.Sprintf("Group %d denied.", id)
}

func (b *Bot) cmdRevokeGroup(args string) string {
	id, err := strconv.ParseInt(args, 10, 64)
	if err != nil {
		return "Usage: /revoke-group <id>"
	}
	b.store.SetGroupStatus(id, "pending")
	return fmt.Sprintf("Group %d access revoked.", id)
}

func (b *Bot) errorMessage(err error) string {
	s := err.Error()
	if strings.Contains(s, "rate limited") {
		return "I'm being rate limited, please try again in a moment."
	}
	if strings.Contains(s, "authentication") {
		return "Bot configuration error. Please contact the owner."
	}
	if strings.Contains(s, "server error") {
		return "Claude is temporarily unavailable."
	}
	return "An error occurred. Please try again."
}

func parseFileSize(s string) int64 {
	s = strings.TrimSpace(strings.ToUpper(s))
	if strings.HasSuffix(s, "MB") {
		n, err := strconv.ParseInt(strings.TrimSuffix(s, "MB"), 10, 64)
		if err != nil {
			return 10 * 1024 * 1024
		}
		return n * 1024 * 1024
	}
	if strings.HasSuffix(s, "KB") {
		n, err := strconv.ParseInt(strings.TrimSuffix(s, "KB"), 10, 64)
		if err != nil {
			return 10 * 1024 * 1024
		}
		return n * 1024
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 10 * 1024 * 1024
	}
	return n
}
```

- [ ] **Step 2: Run build to check compilation**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go build ./internal/bot/
```
Expected: no errors

- [ ] **Step 3: Update main.go to wire everything together**

Replace `cmd/dcbot/main.go` with:
```go
package main

import (
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/chatmail/rpc-client-go/v2/deltachat"
	"github.com/deltachat-bot/deltabot-cli-go/v2/botcli"
	"github.com/jhayashi/dcbot/internal/bot"
	"github.com/jhayashi/dcbot/internal/claude"
	"github.com/jhayashi/dcbot/internal/config"
	"github.com/jhayashi/dcbot/internal/store"
	"github.com/spf13/cobra"
)

func main() {
	cli := botcli.New("dcbot")

	var (
		flagConfig  string
		flagDataDir string
		flagModel   string
		flagAPIKey  string
		flagLogLevel string
	)

	cli.OnBotInit(func(cli *botcli.BotCli, dcBot *deltachat.Bot, cmd *cobra.Command, args []string) {
		// Load config
		cfg, err := config.Load(flagConfig)
		if err != nil {
			log.Fatalf("load config: %v", err)
		}
		cfg.ApplyEnv()

		// Apply CLI flag overrides
		if flagAPIKey != "" {
			cfg.Claude.APIKey = flagAPIKey
		}
		if flagModel != "" {
			cfg.Claude.Model = flagModel
		}
		if flagDataDir != "" {
			cfg.Bot.DataDir = flagDataDir
		}
		if flagLogLevel != "" {
			cfg.Bot.LogLevel = flagLogLevel
		}

		if cfg.Claude.APIKey == "" {
			log.Fatal("Claude API key required. Set via --api-key, ANTHROPIC_API_KEY env var, or config file.")
		}

		// Setup logger
		level := slog.LevelInfo
		switch cfg.Bot.LogLevel {
		case "debug":
			level = slog.LevelDebug
		case "warn":
			level = slog.LevelWarn
		case "error":
			level = slog.LevelError
		}
		logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

		// Open store
		dataDir := os.ExpandEnv(cfg.Bot.DataDir)
		if err := os.MkdirAll(dataDir, 0755); err != nil {
			log.Fatalf("create data dir: %v", err)
		}
		dbPath := filepath.Join(dataDir, "dcbot.db")
		st, err := store.Open(dbPath)
		if err != nil {
			log.Fatalf("open store: %v", err)
		}

		// Create Claude client
		cl := claude.NewClient(cfg.Claude.APIKey, cfg.Claude.Model, cfg.Claude.MaxTokens, "")

		// Create bot
		b := bot.New(cfg, st, cl, logger)

		dcBot.OnNewMsg(b.HandleMessage)

		logger.Info("dcbot initialized",
			"model", cfg.Claude.Model,
			"owner", cfg.Owner.Email,
			"mode", cfg.Bot.DefaultMode,
		)
	})

	// Add custom flags to the serve command
	serveCmd := cli.GetServeCmd()
	if serveCmd != nil {
		flags := serveCmd.Flags()
		flags.StringVar(&flagConfig, "config", defaultConfigPath(), "Config file path")
		flags.StringVar(&flagDataDir, "data-dir", "", "Data directory")
		flags.StringVar(&flagModel, "model", "", "Claude model override")
		flags.StringVar(&flagAPIKey, "api-key", "", "Anthropic API key")
		flags.StringVar(&flagLogLevel, "log-level", "", "Log level (debug, info, warn, error)")
	}

	if err := cli.Start(); err != nil {
		log.Fatal(err)
	}
}

func defaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "config.toml"
	}
	return filepath.Join(home, ".config", "dcbot", "config.toml")
}
```

- [ ] **Step 4: Check if botcli has GetServeCmd; if not, adjust flag registration**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go build ./cmd/dcbot/ 2>&1
```

If `GetServeCmd` doesn't exist, the flags need to be registered differently. The `botcli` framework uses `cobra` and the serve subcommand may need to be accessed via `cli.Cmd` or similar. Adjust based on compilation errors. A simpler approach is to use `cli.AddCommand` to add a custom serve command, or register persistent flags on the root command.

**Fallback approach if GetServeCmd doesn't exist:** Register flags as persistent flags via cobra on init:

```go
// In main(), before cli.Start():
// Use OnBotInit to access the cmd and register flags
```

Or read flags from environment/config only (no cobra flags on serve).

- [ ] **Step 5: Verify build succeeds**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go mod tidy
go build ./cmd/dcbot/
```
Expected: binary builds successfully.

- [ ] **Step 6: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/bot/bot.go cmd/dcbot/main.go
git commit -m "feat: wire up core bot logic with access control, commands, and Claude integration"
```

---

### Task 9: Integration Test with End-to-End Flow

**Files:**
- Create: `internal/bot/bot_test.go`

This task adds tests for the command handler logic and mode/history integration without requiring a real Delta Chat connection.

- [ ] **Step 1: Write integration tests for command handling and mode logic**

Create `internal/bot/bot_test.go`:
```go
package bot

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jhayashi/dcbot/internal/claude"
	"github.com/jhayashi/dcbot/internal/config"
	"github.com/jhayashi/dcbot/internal/session"
	"github.com/jhayashi/dcbot/internal/store"
)

func newTestBot(t *testing.T) *Bot {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	cfg := config.Defaults()
	cfg.Owner.Email = "owner@example.com"

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	return &Bot{
		cfg:      cfg,
		store:    st,
		sessions: session.New(30 * time.Minute),
		claude:   nil, // not needed for command tests
		logger:   logger,
	}
}

func TestHelpText(t *testing.T) {
	b := newTestBot(t)

	// Regular user sees basic commands
	text := b.helpText("user@example.com")
	if !contains(text, "/help") || !contains(text, "/mode") || !contains(text, "/clear") {
		t.Errorf("missing basic commands in help text")
	}
	if contains(text, "/approve") {
		t.Errorf("non-owner should not see owner commands")
	}

	// Owner sees all commands
	text = b.helpText("owner@example.com")
	if !contains(text, "/approve") || !contains(text, "/deny") {
		t.Errorf("owner should see owner commands")
	}
}

func TestCmdApproveAndDeny(t *testing.T) {
	b := newTestBot(t)

	result := b.cmdApprove("alice@example.com")
	if !contains(result, "approved") {
		t.Errorf("approve result = %q", result)
	}
	u, _ := b.store.GetUser("alice@example.com")
	if u.Status != "approved" {
		t.Errorf("status = %q, want approved", u.Status)
	}

	result = b.cmdDeny("alice@example.com")
	if !contains(result, "blocked") {
		t.Errorf("deny result = %q", result)
	}
	u, _ = b.store.GetUser("alice@example.com")
	if u.Status != "blocked" {
		t.Errorf("status = %q, want blocked", u.Status)
	}

	// Re-approve a blocked user
	result = b.cmdApprove("alice@example.com")
	u, _ = b.store.GetUser("alice@example.com")
	if u.Status != "approved" {
		t.Errorf("status after re-approve = %q, want approved", u.Status)
	}
}

func TestCmdRevoke(t *testing.T) {
	b := newTestBot(t)
	b.cmdApprove("alice@example.com")
	b.cmdRevoke("alice@example.com")

	u, _ := b.store.GetUser("alice@example.com")
	if u.Status != "pending" {
		t.Errorf("status = %q, want pending", u.Status)
	}
}

func TestCmdMode(t *testing.T) {
	b := newTestBot(t)
	b.store.EnsureUser("alice@example.com")

	result := b.cmdMode("alice@example.com", false, 0, nil, "persistent")
	if !contains(result, "persistent") {
		t.Errorf("mode result = %q", result)
	}

	u, _ := b.store.GetUser("alice@example.com")
	if u.Mode == nil || *u.Mode != "persistent" {
		t.Errorf("mode = %v", u.Mode)
	}

	// Invalid mode
	result = b.cmdMode("alice@example.com", false, 0, nil, "invalid")
	if !contains(result, "Usage") {
		t.Errorf("invalid mode result = %q", result)
	}
}

func TestOwnerOnly(t *testing.T) {
	b := newTestBot(t)

	result := b.ownerOnly("notowner@example.com", func() string { return "ok" })
	if !contains(result, "only available to the bot owner") {
		t.Errorf("non-owner result = %q", result)
	}

	result = b.ownerOnly("owner@example.com", func() string { return "ok" })
	if result != "ok" {
		t.Errorf("owner result = %q", result)
	}
}

func TestHistoryModes(t *testing.T) {
	b := newTestBot(t)
	chatID := "user:alice@example.com"

	// Ephemeral returns nothing
	msgs := b.loadHistory(chatID, "ephemeral")
	if len(msgs) != 0 {
		t.Errorf("ephemeral history should be empty")
	}

	// Session mode
	b.saveToHistory(chatID, "session", claude.ChatMessage{Role: "user", Content: "hello"})
	msgs = b.loadHistory(chatID, "session")
	if len(msgs) != 1 {
		t.Errorf("session history len = %d, want 1", len(msgs))
	}

	// Persistent mode
	b.saveToHistory(chatID, "persistent", claude.ChatMessage{Role: "user", Content: "saved"})
	msgs = b.loadHistory(chatID, "persistent")
	if len(msgs) != 1 {
		t.Errorf("persistent history len = %d, want 1", len(msgs))
	}
}

func TestParseFileSize(t *testing.T) {
	tests := []struct {
		input string
		want  int64
	}{
		{"10MB", 10 * 1024 * 1024},
		{"5mb", 5 * 1024 * 1024},
		{"100KB", 100 * 1024},
		{"1024", 1024},
	}
	for _, tt := range tests {
		got := parseFileSize(tt.input)
		if got != tt.want {
			t.Errorf("parseFileSize(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./internal/bot/ -v
```
Expected: PASS

- [ ] **Step 3: Run all tests**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go test ./... -v
```
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add internal/bot/bot_test.go
git commit -m "test: add unit tests for bot commands, access control, and history modes"
```

---

### Task 10: Final Polish and README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:
```markdown
# dcbot

A self-hosted Delta Chat bot that bridges conversations to Anthropic's Claude API.

## Prerequisites

- Go 1.22+
- `deltachat-rpc-server` on your PATH ([install instructions](https://github.com/chatmail/core/tree/main/deltachat-rpc-server))
- An email account for the bot
- An Anthropic API key

## Install

```bash
go install github.com/jhayashi/dcbot/cmd/dcbot@latest
```

Or build from source:

```bash
git clone https://github.com/jhayashi/dcbot.git
cd dcbot
go build -o dcbot ./cmd/dcbot/
```

## Setup

1. Initialize the bot with an email account:

```bash
dcbot init bot@example.com PASSWORD
```

2. Create a config file at `~/.config/dcbot/config.toml`:

```toml
[claude]
api_key = "sk-ant-..."  # or use ANTHROPIC_API_KEY env var
model = "claude-sonnet-4-6-20250514"

[owner]
email = "your@email.com"
```

3. Start the bot:

```bash
dcbot serve
```

## Usage

Message the bot's email address from any Delta Chat client. New users must be approved by the owner.

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/mode <ephemeral\|session\|persistent>` | Switch conversation mode |
| `/clear` | Clear conversation history |
| `/status` | Show current mode and message count |

### Owner Commands

| Command | Description |
|---------|-------------|
| `/approve <email>` | Approve a pending user |
| `/deny <email>` | Block a user |
| `/revoke <email>` | Remove user access |
| `/users` | List all users |
| `/approve-group <id>` | Approve a group |

## License

MIT
```

- [ ] **Step 2: Run final build and test**

Run:
```bash
cd /var/home/jhayashi/src/dcbot
go build ./cmd/dcbot/ && go test ./... -v
```
Expected: Build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /var/home/jhayashi/src/dcbot
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

- [ ] **Step 4: Push to remote**

```bash
cd /var/home/jhayashi/src/dcbot
git push -u origin main
```
