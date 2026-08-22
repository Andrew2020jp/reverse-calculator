# 四則逆算電卓

□（わからない数）が入った四則演算を入力すると、□の答えと計算の流れを表示する静的な学習用電卓です。

## Features

- `＋` `−` `×` `÷` `%` と括弧に対応
- `□` `【】` `x` `X` `?` を未知数として利用可能
- 小数・分数表示、計算ステップ、最近の計算履歴に対応
- ビルドツール不要で動作する HTML / CSS / JavaScript サイト
- GitHub Pages 用の自動デプロイ workflow 付き

## Website

公開版はこちら: [四則逆算電卓を開く](https://andrew2020jp.github.io/reverse-calculator/)

## Run locally

ブラウザで `index.html` を開くだけで動作します。ローカルサーバーを使う場合は、次のように起動できます。

```bash
python -m http.server 8000
```

その後、`http://localhost:8000/` を開いてください。

## Deploy

`main` ブランチへ push すると、`.github/workflows/deploy-pages.yml` が GitHub Pages に公開します。
リポジトリの Settings → Pages で、公開元に **GitHub Actions** を選択してください。

