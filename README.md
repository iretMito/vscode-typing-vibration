# Vibe Coding

VSCodeで文字を入力するたびに、同じネットワーク上のスマホがバイブレーションするVSCode拡張機能。

## アーキテクチャ

```
[VSCode Extension] --WebSocket--> [スマホブラウザ]
     |                                  |
  onDidChangeTextDocument          3層バイブレーション
  (50msスロットル)                  1. navigator.vibrate (Android)
     |                             2. checkbox switch hack (iOS 18+)
  HTTP+WSサーバー                   3. 低周波音フォールバック (全端末)
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
├── tsconfig.json
├── .vscodeignore
└── .gitignore
```

## 主な機能

### extension.ts

- HTTP静的配信 + WebSocketサーバー（ポート8765、使用中なら自動フォールバック）
- 50msスロットル付きテキスト変更リスナー（高速タイピングでも即応性を維持）
- ステータスバーにローカルIP・接続クライアント数を表示

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

## 使い方

1. VSCodeで `vscode-vibe-coding` フォルダを開く
2. `npm install` で依存パッケージをインストール
3. F5キーでExtension Development Hostを起動
4. コマンドパレット（`Cmd+Shift+P`）→ **Vibe Coding: Start Server** を実行
5. ステータスバーに表示されたURL（例: `http://192.168.1.5:8765`）をスマホブラウザで開く
6. **TAP TO START** ボタンをタップ（ブラウザのオーディオ/バイブレーション許可に必要）
7. VSCodeで文字を入力 → スマホが振動する

サーバーを停止するには、コマンドパレットから **Vibe Coding: Stop Server** を実行するか、ステータスバーのアイテムをクリック。

## 技術的な補足

- スマホからアクセスできるよう `0.0.0.0` にバインドしている（PCとスマホが同一ネットワークであること）
- iOSではブラウザの制約により `navigator.vibrate` が使えないため、iOS 18の `checkbox switch` 触覚フィードバックハックと低周波音で代替している
- 「TAP TO START」ボタンはブラウザのユーザーインタラクション要件を満たすために必須（AudioContextの初期化等）
- 音量をオンにすると低周波音レイヤーの効果が高まる
