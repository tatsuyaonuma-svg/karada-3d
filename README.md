# からだの立体図鑑

全身の解剖を3Dで見るビューアです。まわす・拡大する・部位をさわると名前が出ます。
[somatic studio](https://www.somaticstudiojapan.com/)（鍼灸師・大沼竜也）が、身体を学ぶ人のために無料で公開しています。

## 3Dデータの出どころとライセンス

このリポジトリに含まれる3Dデータ（`data/*.glb`）は、以下から作りました。

- **BodyParts3D** — The Database Center for Life Science — **CC BY-SA 2.1 Japan**
- **Z-Anatomy** — the libre 3D atlas of anatomy — **CC BY-SA 4.0**
  （Kousaku OKUBO / Gauthier KERVYN / Marcin ZIELINSKI ほか）

一部に次のデータが含まれます。
- Cranial Nerves and Foramina — University of Dundee, CAHID — CC BY 4.0
- Anatomy of the Inner Ear — University of Dundee School of Medicine — **CC BY-NC-SA 4.0**
- Kidney — Lissie Cowley — **CC BY-NC 4.0**

**CC BY-SA の継承条件により、このリポジトリの3Dデータも同じ CC BY-SA 4.0 で配布します。**
内耳と腎臓のデータは商用利用が禁じられているため、このビューアと3Dデータは**すべて無料**で提供し、商用利用はしません。

## ビューアのコード

`index.html` / `app.js` は somatic studio が書いたものです。
three.js（MIT）と Draco（Apache-2.0）を `vendor/` に同梱しています。

## 使い方

`index.html` をそのまま開くか、静的なウェブサーバーに置いてください。
