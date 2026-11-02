import { all, get, run, now, tx } from '../db.ts';

/**
 * WCAG 2.2 Level A and AA success criteria that automated checks (axe-core) cannot fully cover.
 * Titles are the W3C short names; zh titles follow the W3C Chinese naming where one exists.
 */
export const CRITERIA: { id: string; level: 'A' | 'AA'; en: string; zh: string }[] = [
  { id: '1.1.1', level: 'A', en: 'Non-text Content (meaningful alternatives)', zh: '非文本内容（替代文本是否有意义）' },
  { id: '1.2.1', level: 'A', en: 'Audio-only and Video-only (Prerecorded)', zh: '仅音频和仅视频（预录）' },
  { id: '1.2.2', level: 'A', en: 'Captions (Prerecorded)', zh: '字幕（预录）' },
  { id: '1.2.3', level: 'A', en: 'Audio Description or Media Alternative (Prerecorded)', zh: '音频描述或媒体替代（预录）' },
  { id: '1.2.4', level: 'AA', en: 'Captions (Live)', zh: '字幕（直播）' },
  { id: '1.2.5', level: 'AA', en: 'Audio Description (Prerecorded)', zh: '音频描述（预录）' },
  { id: '1.3.1', level: 'A', en: 'Info and Relationships', zh: '信息和关系' },
  { id: '1.3.2', level: 'A', en: 'Meaningful Sequence', zh: '有意义的顺序' },
  { id: '1.3.3', level: 'A', en: 'Sensory Characteristics', zh: '感官特征' },
  { id: '1.3.4', level: 'AA', en: 'Orientation', zh: '屏幕方向' },
  { id: '1.3.5', level: 'AA', en: 'Identify Input Purpose', zh: '识别输入目的' },
  { id: '1.4.1', level: 'A', en: 'Use of Color', zh: '颜色的使用' },
  { id: '1.4.2', level: 'A', en: 'Audio Control', zh: '音频控制' },
  { id: '1.4.3', level: 'AA', en: 'Contrast (Minimum) – text on images and gradients', zh: '对比度（最低）——图片和渐变上的文字' },
  { id: '1.4.4', level: 'AA', en: 'Resize Text', zh: '调整文字大小' },
  { id: '1.4.5', level: 'AA', en: 'Images of Text', zh: '文字图像' },
  { id: '1.4.10', level: 'AA', en: 'Reflow', zh: '重排' },
  { id: '1.4.11', level: 'AA', en: 'Non-text Contrast', zh: '非文本对比度' },
  { id: '1.4.12', level: 'AA', en: 'Text Spacing', zh: '文本间距' },
  { id: '1.4.13', level: 'AA', en: 'Content on Hover or Focus', zh: '悬停或获得焦点时的内容' },
  { id: '2.1.1', level: 'A', en: 'Keyboard', zh: '键盘' },
  { id: '2.1.2', level: 'A', en: 'No Keyboard Trap', zh: '没有键盘陷阱' },
  { id: '2.1.4', level: 'A', en: 'Character Key Shortcuts', zh: '字符键快捷键' },
  { id: '2.2.1', level: 'A', en: 'Timing Adjustable', zh: '时间可调' },
  { id: '2.2.2', level: 'A', en: 'Pause, Stop, Hide', zh: '暂停、停止、隐藏' },
  { id: '2.3.1', level: 'A', en: 'Three Flashes or Below Threshold', zh: '三次闪烁或低于阈值' },
  { id: '2.4.1', level: 'A', en: 'Bypass Blocks', zh: '跳过区块' },
  { id: '2.4.2', level: 'A', en: 'Page Titled (descriptive titles)', zh: '网页标题（标题是否具描述性）' },
  { id: '2.4.3', level: 'A', en: 'Focus Order', zh: '焦点顺序' },
  { id: '2.4.4', level: 'A', en: 'Link Purpose (In Context)', zh: '链接目的（上下文中）' },
  { id: '2.4.5', level: 'AA', en: 'Multiple Ways', zh: '多种途径' },
  { id: '2.4.6', level: 'AA', en: 'Headings and Labels', zh: '标题和标签' },
  { id: '2.4.7', level: 'AA', en: 'Focus Visible', zh: '焦点可见' },
  { id: '2.4.11', level: 'AA', en: 'Focus Not Obscured (Minimum)', zh: '焦点未被遮挡（最低）' },
  { id: '2.5.1', level: 'A', en: 'Pointer Gestures', zh: '指针手势' },
  { id: '2.5.2', level: 'A', en: 'Pointer Cancellation', zh: '指针取消' },
  { id: '2.5.3', level: 'A', en: 'Label in Name', zh: '名称中包含标签' },
  { id: '2.5.4', level: 'A', en: 'Motion Actuation', zh: '动作驱动' },
  { id: '2.5.7', level: 'AA', en: 'Dragging Movements', zh: '拖动动作' },
  { id: '2.5.8', level: 'AA', en: 'Target Size (Minimum)', zh: '目标尺寸（最低）' },
  { id: '3.1.2', level: 'AA', en: 'Language of Parts', zh: '部分内容的语言' },
  { id: '3.2.1', level: 'A', en: 'On Focus', zh: '获得焦点时' },
  { id: '3.2.2', level: 'A', en: 'On Input', zh: '输入时' },
  { id: '3.2.3', level: 'AA', en: 'Consistent Navigation', zh: '一致的导航' },
  { id: '3.2.4', level: 'AA', en: 'Consistent Identification', zh: '一致的标识' },
  { id: '3.2.6', level: 'A', en: 'Consistent Help', zh: '一致的帮助' },
  { id: '3.3.1', level: 'A', en: 'Error Identification', zh: '错误识别' },
  { id: '3.3.2', level: 'A', en: 'Labels or Instructions', zh: '标签或说明' },
  { id: '3.3.3', level: 'AA', en: 'Error Suggestion', zh: '错误建议' },
  { id: '3.3.4', level: 'AA', en: 'Error Prevention (Legal, Financial, Data)', zh: '错误预防（法律、财务、数据）' },
  { id: '3.3.7', level: 'A', en: 'Redundant Entry', zh: '冗余输入' },
  { id: '3.3.8', level: 'AA', en: 'Accessible Authentication (Minimum)', zh: '无障碍身份验证（最低）' },
  { id: '4.1.2', level: 'A', en: 'Name, Role, Value (custom widgets)', zh: '名称、角色、值（自定义控件）' },
  { id: '4.1.3', level: 'AA', en: 'Status Messages', zh: '状态消息' },
];
export const STATUSES = ['not_checked', 'pass', 'fail', 'na'] as const;
export type Status = typeof STATUSES[number];
export const fieldKey = (id: string) => 'c' + id.replace(/\./g, '_');
export const NOTES_MAX = 2000;

export interface CheckRow { criterion: string; level: string; en: string; zh: string; status: Status; notes: string | null; assignee_id: string | null; assignee_email: string | null; checked_by_email: string | null; checked_at: string | null }

/** Checklist for a site: every criterion, merged with what the team recorded. */
export function checklist(siteId: string): CheckRow[] {
  const rows = new Map(all<any>(`SELECT m.*, a.email AS assignee_email, b.email AS checked_by_email FROM manual_checks m
    LEFT JOIN users a ON a.id = m.assignee_id LEFT JOIN users b ON b.id = m.checked_by WHERE m.site_id = ?`, siteId).map((r) => [r.criterion, r]));
  return CRITERIA.map((c) => { const r = rows.get(c.id);
    return { criterion: c.id, level: c.level, en: c.en, zh: c.zh, status: (r?.status ?? 'not_checked') as Status, notes: r?.notes ?? null,
      assignee_id: r?.assignee_id ?? null, assignee_email: r?.assignee_email ?? null, checked_by_email: r?.checked_by_email ?? null, checked_at: r?.checked_at ?? null }; });
}
export function summary(siteId: string) {
  const s = { total: CRITERIA.length, pass: 0, fail: 0, na: 0, not_checked: 0 } as Record<string, number>;
  for (const r of checklist(siteId)) s[r.status]++;
  return s as { total: number; pass: number; fail: number; na: number; not_checked: number };
}

/**
 * Save submitted rows. "Last checked by/when" moves only when status or notes actually change;
 * changing just the assignee keeps it. Unknown criteria, statuses and non-member assignees are ignored.
 */
export function saveChecklist(siteId: string, teamId: string, userId: string, form: Record<string, any>): number {
  const members = new Set(all<any>('SELECT user_id FROM memberships WHERE team_id = ?', teamId).map((m) => m.user_id));
  const current = new Map(checklist(siteId).map((r) => [r.criterion, r]));
  let changed = 0; const at = now();
  tx(() => {
    for (const c of CRITERIA) {
      const k = fieldKey(c.id); if (!(`${k}_status` in form)) continue;
      const status = String(form[`${k}_status`]) as Status; if (!STATUSES.includes(status)) continue;
      const notes = String(form[`${k}_notes`] ?? '').trim().slice(0, NOTES_MAX) || null;
      const aRaw = String(form[`${k}_assignee`] ?? ''); const assignee = members.has(aRaw) ? aRaw : null;
      const cur = current.get(c.id)!;
      const checkedChanged = cur.status !== status || (cur.notes ?? null) !== notes;
      if (!checkedChanged && cur.assignee_id === assignee) continue;
      const prev = get<any>('SELECT checked_by, checked_at FROM manual_checks WHERE site_id = ? AND criterion = ?', siteId, c.id);
      run(`INSERT INTO manual_checks (site_id, criterion, status, notes, assignee_id, checked_by, checked_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (site_id, criterion) DO UPDATE SET status = excluded.status, notes = excluded.notes, assignee_id = excluded.assignee_id,
        checked_by = excluded.checked_by, checked_at = excluded.checked_at, updated_at = excluded.updated_at`,
        siteId, c.id, status, notes, assignee, checkedChanged ? userId : prev?.checked_by ?? null, checkedChanged ? at : prev?.checked_at ?? null, at);
      changed++;
    }
  });
  return changed;
}
