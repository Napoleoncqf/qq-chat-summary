/**
 * Quick test: verify forward message expansion against real NapCat data.
 * Usage: npx tsx scripts/test-forward.ts
 */
import axios from 'axios';

const ONEBOT_URL = process.env.ONEBOT_HTTP_URL || 'http://127.0.0.1:3000';
const GROUP_ID = process.env.TARGET_GROUP_IDS?.split(',')[0]?.split(':')[0] || '247592449';

const MAX_SUB_MESSAGES = 20;
const MAX_CHAR_PER_MSG = 500;
const FORWARD_CQ_REGEX = /\[CQ:forward,[^\]]*\]/g;

interface RawMsgSegment {
  type: string;
  data: Record<string, any>;
}

interface RawMsg {
  time: number;
  sender: { user_id: number; nickname: string; card?: string };
  raw_message: string;
  message_id: number;
  group_id: number;
  message?: RawMsgSegment[];
}

async function main() {
  console.log(`Fetching history from group ${GROUP_ID}...`);

  // Fetch enough messages to find forwards
  const resp = await axios.post(`${ONEBOT_URL}/get_group_msg_history`, {
    group_id: Number(GROUP_ID),
    count: 500,
  }, { timeout: 30000 });

  const msgs: RawMsg[] = resp.data?.data?.messages || [];
  console.log(`Got ${msgs.length} messages total\n`);

  // Find forward messages
  const forwardMsgs = msgs.filter(m =>
    m.message?.some(s => s.type === 'forward') ||
    /\[CQ:forward,/.test(m.raw_message)
  );

  console.log(`Found ${forwardMsgs.length} forward message(s)\n`);

  if (forwardMsgs.length === 0) {
    // Fetch older batch
    const earliest = msgs.reduce((a, b) => a.time < b.time ? a : b);
    console.log(`No forwards in recent batch. Trying older messages (before msg_id=${earliest.message_id})...`);
    const resp2 = await axios.post(`${ONEBOT_URL}/get_group_msg_history`, {
      group_id: Number(GROUP_ID),
      count: 500,
      message_seq: earliest.message_id,
      reverseOrder: true,
    }, { timeout: 30000 });

    const msgs2: RawMsg[] = resp2.data?.data?.messages || [];
    console.log(`Got ${msgs2.length} older messages\n`);

    const forwardMsgs2 = msgs2.filter(m =>
      m.message?.some(s => s.type === 'forward') ||
      /\[CQ:forward,/.test(m.raw_message)
    );

    if (forwardMsgs2.length === 0) {
      console.log('No forward messages found in 1000 messages. Cannot test.');
      return;
    }

    forwardMsgs.push(...forwardMsgs2);
    console.log(`Found ${forwardMsgs2.length} forward message(s) in older batch\n`);
  }

  // Test expansion on each forward message
  for (const msg of forwardMsgs) {
    console.log(`${'='.repeat(60)}`);
    console.log(`Message ID: ${msg.message_id}`);
    console.log(`Original raw_message (first 100): ${msg.raw_message.slice(0, 100)}...`);
    console.log(`Sender: ${msg.sender.card || msg.sender.nickname}`);

    // Check inline segment data
    const forwardSeg = msg.message?.find(s => s.type === 'forward');

    if (forwardSeg?.data?.content && Array.isArray(forwardSeg.data.content)) {
      const subMessages = forwardSeg.data.content;
      console.log(`\n[Inline] ${subMessages.length} sub-messages found`);

      const capped = subMessages.slice(0, MAX_SUB_MESSAGES);
      const expandedParts: string[] = [];

      for (const sub of capped) {
        const name = sub.sender?.card || sub.sender?.nickname || String(sub.sender?.user_id || '未知');
        let content: string = sub.raw_message || '';

        content = content.replace(/\[CQ:forward,[^\]]*\]/g, '[嵌套转发，已略]');
        content = content.replace(/\[CQ:[^\]]+\]/g, '').trim();
        if (content.length > MAX_CHAR_PER_MSG) {
          content = content.slice(0, MAX_CHAR_PER_MSG) + '…';
        }

        if (content) {
          expandedParts.push(`【转发·${name}】${content}`);
        }
      }

      console.log(`\nExpanded text (${expandedParts.length} non-empty entries):`);
      const expanded = expandedParts.join('\n');
      console.log(expanded || '(all sub-messages were media-only)');

      if (subMessages.length > MAX_SUB_MESSAGES) {
        console.log(`[…共${subMessages.length}条转发，已展示前${MAX_SUB_MESSAGES}条]`);
      }
    } else {
      console.log('\n[No inline data] Would need API fallback');

      // Try API fallback
      const idMatch = msg.raw_message.match(/\[CQ:forward,[^\]]*?id=([^,\]]+)/);
      if (idMatch) {
        console.log(`Forward ID: ${idMatch[1]}`);
        try {
          const fwdResp = await axios.post(`${ONEBOT_URL}/get_forward_msg`, {
            id: idMatch[1]
          }, { timeout: 5000 });
          console.log(`API response retcode: ${fwdResp.data?.retcode}`);
          const apiMsgs = fwdResp.data?.data?.messages || [];
          console.log(`API returned ${apiMsgs.length} sub-messages`);
        } catch (err: any) {
          console.log(`API call failed: ${err.message}`);
        }
      }
    }
    console.log();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
