# foldory

ローカルのテキストナレッジディレクトリに対する軽量な MCP アクセスレイヤーです。

Foldory は、設定された一つのルートディレクトリ配下のファイルを MCP ツールとして公開します。
データベース、独自ファイルフォーマット、変更履歴は持ちません。
ユーザーは自分のディレクトリとテキストファイルをそのまま管理し続けられます。

ディレクトリ構成の例:

```text
~/knowledge/
  project1/
    overview.md
    discussion.md
  project2/
    ideas.md
```

ルート直下のディレクトリはワークスペースとして扱われます。
ワークスペースの意味づけはユーザーに委ねられています。プロジェクト、トピック、個人メモ、リサーチなど、自由に使えます。

## 使い方

```sh
pnpm install
pnpm build
node dist/index.js --root ~/knowledge
```

開発時:

```sh
pnpm dev -- --root ~/knowledge
```

MCP クライアントからローカル stdio コマンドとしてサーバーを起動できます:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/foldory/dist/index.js", "--root", "/absolute/path/to/knowledge"]
}
```

## ツール

| ツール名           | 説明                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `list_workspaces`  | ルート直下のワークスペースディレクトリを一覧表示します。         |
| `create_workspace` | ルート直下にワークスペースディレクトリを作成します。             |
| `list_files`       | ワークスペース内の通常ファイルを一覧表示します。                 |
| `read_files`       | 1つ以上のテキストファイルを読み取ります。                        |
| `write_file`       | テキストファイルを上書きまたは新規作成します。                   |
| `append_file`      | テキストを追記します。ファイルが存在しない場合は新規作成します。 |
| `search_files`     | プレーンな部分文字列クエリでテキストファイルを検索します。       |
