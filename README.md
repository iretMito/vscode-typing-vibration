# Vibe Coding (Joke)

VSCodeで文字を入力するたびに、エディタが揺れ、同じネットワーク上のスマホがバイブレーションするVSCode拡張機能。

## アーキテクチャ

```
[VSCode Extension] --WebSocket--> [スマホブラウザ]
     |                                  |
  onDidChangeTextDocument          3層バイブレーション
  (50msスロットル)                  1. navigator.vibrate (Android)
     |                             2. checkbox switch hack (iOS 18+)
     ├── エディタシェイク             3. 低周波音フォールバック (全端末)
     │   (decorationによる画面揺れ)
     └── HTTP+WSサーバー
         (0.0.0.0:8765)
```

## ファイル構成

```
vscode-vibe-coding/
├── .vscode/
│   ├── launch.json          # F5デバッグ設定
│   └── tasks.json           # tsc watchタスク
├── src/
│   └── extension.ts         # 拡張機能メイン
├── media/
│   ├── index.html           # スマホ用UI
│   └── client.js            # WebSocket + バイブレーションロジック
├── package.json             # 拡張機能マニフェスト
├── package.nls.json         # 多言語リソース（英語・デフォルト）
├── package.nls.ja.json      # 多言語リソース（日本語）
├── tsconfig.json
├── .vscodeignore
└── .gitignore
```

## 主な機能

### エディタシェイク

タイピングに連動してエディタ画面を左右に揺らす視覚フィードバック。TextEditorDecorationTypeの`margin-left`を動的に切り替えることで実現。

- 強度レベル1〜5に対応（ピクセルオフセット＋持続時間を段階的に変化）
- サーバ不要で単体動作可能

| Level | 右offset | 左offset | Step duration |
|-------|---------|---------|---------------|
| 1     | 2px     | -1px    | 20ms          |
| 2     | 3px     | -1px    | 25ms          |
| 3     | 4px     | -2px    | 30ms (default)|
| 4     | 6px     | -3px    | 35ms          |
| 5     | 8px     | -4px    | 40ms          |

### スマホバイブレーション (HTTP/WSサーバー)

- HTTP静的配信 + WebSocketサーバー（ポート8765、使用中なら自動フォールバック）
- 50msスロットル付きテキスト変更リスナー（高速タイピングでも即応性を維持）
- ステータスバーにローカルIP・接続クライアント数を表示
- 設定からサーバ起動の有無を切替可能

### client.js - 3層バイブレーションエンジン

端末を問わず最大限の体感を提供するため、3層を同時実行する。

| Layer | 方式 | 対象端末 |
|-------|------|----------|
| 1 | `navigator.vibrate(40)` | Android Chrome |
| 2 | iOS `<input type="checkbox" switch>` ハプティックハック | iOS 18+ Safari |
| 3 | 50Hz低周波音 (AudioContext) | 全端末（フォールバック） |

その他:

- WebSocket自動再接続（exponential backoff、最大30秒）
- バイブレーション発火時の視覚フラッシュフィードバック
- 入力カウンター表示

## 設定

VSCodeの設定画面（`Ctrl+,` / `Cmd+,`）で「Vibe Coding」を検索すると以下の項目が表示される。

| 設定キー | 型 | デフォルト | 説明 |
|---------|-----|-----------|------|
| `vibeCoding.editorShake.enabled` | boolean | `true` | エディタシェイク効果の有効/無効 |
| `vibeCoding.editorShake.intensity` | number (1-5) | `3` | シェイクの強さ |
| `vibeCoding.server.enabled` | boolean | `true` | スマホバイブ用ローカルサーバの起動有無 |

設定の組み合わせにより、以下のモードで動作する:

| editorShake | server | 動作 |
|-------------|--------|------|
| ON | ON | 画面シェイク + スマホバイブ |
| ON | OFF | 画面シェイクのみ |
| OFF | ON | スマホバイブのみ |
| OFF | OFF | 何も起きない |

設定変更はリロード不要で即座に反映される。サーバのON/OFFも動作中に動的に切り替わる。

### 多言語対応

VSCodeの言語設定に応じて、設定画面やコマンド名が英語/日本語で自動的に切り替わる。

## インストール

### 前提条件

- [Node.js](https://nodejs.org/) (v18以上)
- [VSCode](https://code.visualstudio.com/) (v1.85.0以上)

### 手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/iretMito/vscode-typing-vibration.git

# 2. ディレクトリに移動
cd vscode-typing-vibration

# 3. 依存パッケージをインストール
npm install

# 4. TypeScriptをコンパイル
npm run compile

# 5. .vsix ファイルを生成（vsceが未インストールなら先にインストール）
npx @vscode/vsce package

# 6. VSCodeにインストール
code --install-extension vibe-coding-joke-0.0.1.vsix
```

インストール後はVSCodeを再起動（またはウィンドウのリロード）すれば使えるようになる。

## 使い方

1. コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）→ **Vibe Coding: Start** を実行
   - 設定画面の「Getting Started」セクションにあるリンクからも起動可能
2. ステータスバーに表示されたURL（例: `http://192.168.1.5:8765`）をスマホブラウザで開く
   - `vibeCoding.server.enabled` がOFFの場合、サーバは起動せずエディタシェイクのみ動作する
3. **TAP TO START** ボタンをタップ（ブラウザのオーディオ/バイブレーション許可に必要）
4. VSCodeで文字を入力 → エディタが揺れ、スマホが振動する

停止するには、コマンドパレットから **Vibe Coding: Stop** を実行するか、ステータスバーのアイテムをクリック。

### 開発モードで試す場合

1. VSCodeでこのフォルダを開く
2. F5キーでExtension Development Hostを起動
3. 上記の「使い方」と同じ手順で操作

## 技術的な補足

- スマホからアクセスできるよう `0.0.0.0` にバインドしている（PCとスマホが同一ネットワークであること）
- iOSではブラウザの制約により `navigator.vibrate` が使えないため、iOS 18の `checkbox switch` 触覚フィードバックハックと低周波音で代替している
- 「TAP TO START」ボタンはブラウザのユーザーインタラクション要件を満たすために必須（AudioContextの初期化等）
- 音量をオンにすると低周波音レイヤーの効果が高まる
- エディタシェイクは `createTextEditorDecorationType` を利用しており、強度変更時にはdispose→再生成される
