// Dev helper: npm run set-plan -- <email> <none|starter|business|agency> [oneoffCredits]
import { get, run } from '../src/db.ts';
import { PLANS } from '../src/lib/plans.ts';
const [email, plan, credits] = process.argv.slice(2);
if (!email || !(plan in PLANS)) { console.error('usage: npm run set-plan -- <email> <none|starter|business|agency> [oneoffCredits]'); process.exit(1); }
const t = get<any>('SELECT t.id FROM teams t JOIN memberships m ON m.team_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = ? ORDER BY m.created_at LIMIT 1', email.toLowerCase());
if (!t) { console.error('no team for', email); process.exit(1); }
run('UPDATE teams SET plan = ?, oneoff_credits = COALESCE(?, oneoff_credits) WHERE id = ?', plan, credits ? Number(credits) : null, t.id);
console.log(`team ${t.id} → ${plan}`);
