# 修正版宣传片导出

最新修正版输出为根目录 `aotai_promo_synced.mp4`，不会覆盖之前的成片。

修复的直接原因是：旧片在血迹镜头插入了七秒风声却没有对白；片尾画面改成评论区地址后，音轨仍从旧混音拷贝了扫码台词；片尾追加的原始配音还含有长停顿，按固定延时放置会造成相邻台词重叠。

## 当前导出入口

`narration-fixes.json` 是修复段落的唯一旁白/字幕时间轴。`compose.js` 的字幕层和 `export-synced.py` 的音频混合都读取它。修改台词要同时更新音频路径，不能复用旧文案缓存。

1. 运行 `python3 promo/verify-retakes.py`，为修复句录制本地曼波配音并用 Whisper 校验。它选出的素材路径写回时间轴。
2. 运行 `python3 promo/export-synced.py --audio-only`。脚本裁掉首尾静音、压缩长停顿、按句归一音量，必要时使用不变调变速；超过最大变速或会截词时直接失败，不默默切掉尾音。
3. 在本地 Vite 地址渲染血迹素材：`BASE=http://127.0.0.1:53750 node promo/shoot.mjs bloodtrail --params narrated=1 --out promo/build/frames/bloodtrail --q 90`。`narrated=1` 关闭素材内原说明字幕，避免与主字幕叠在一起。
4. 渲染受影响的后半段：`BASE=http://127.0.0.1:53750 node promo/render.mjs --from 42.2666666667 --to 75`。
5. 运行 `python3 promo/check-sync.py`，再运行 `python3 promo/export-synced.py --encode-only`。导出器验证时长、流参数并完整解码。

导出保留原片 0–42.28 秒、49.28–59.54 秒的音频，重新混合血迹段与片尾。旁白不会经过 FFmpeg amix 默认的动态输入归一，避免突然变轻；原风雪和故事节奏不变。总长仍为 75 秒，1080×1920，30 fps，H.264/AAC。

## 无 BGM 版本

运行 `python3 promo/export-no-bgm.py` 从独立的 `voice_final.wav`、程序生成音效与当前修复配音重建声轨。`STEMS_ONLY=1` 分轨分支不读取 `bed.flac`，无须对混合音频做消除。原有主体对白保留约 5ms 的实测处理延迟，血迹插入后的段落按原剪辑点后移七秒。旁白、风声、脚步及交互音效保留，背景音乐不加入。

输出 `aotai_promo_synced_no_bgm.mp4`（原画）和 `aotai_promo_synced_no_bgm_lark.mp4`（飞书传输版）。两者分别直接复制相应有BGM版本的视频包，逐一比较 SHA-256 确认画面完全一致，并验证时长、完整解码、旁白和音效分轨求和残差为零。QA 写入 `build/no-bgm-qa.json`。

发布标题、短视频描述、B站简介、置顶评论和链接统一整理在 `发布文案.txt`。发布前请将评论中的地址实际发出并置顶，以匹配片尾口播。

## 验收材料

音频测量记录写入 `build/synced-audio-qa.json`，重录识别记录写入 `../output/promo-audit/retake-report.json`。另需对最终 MP4 而不是仅对素材做 ASR 核验，并抽查血迹档案、评论区引导、尾部互动的最终帧。旧的 `export-bloodtrail.py` 与 `export-tail-hook.py` 用于历史版本，不是本修正版的导出入口。
