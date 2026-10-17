# c0mpiled-hackathon

## DayBridge (current project direction)

This repo currently contains a running activity recommendation and barrier-analysis prototype (Next.js 16, TypeScript, Zod, Vitest). **DayBridge Unlock** is the proposed next-stage hackathon MVP for consented coordination, disruption recovery, and reviewable feedback. Those capabilities are not yet represented as complete in the baseline.

- [Product and engineering specification](docs/daybridge/PRODUCT_ENGINEERING_SPEC.md)
- [DayBridge quickstart and golden demo](docs/daybridge/README.md)
- [Agent playbook and ownership](docs/daybridge/AGENT_PLAYBOOK.md)
- [Existing human teammate handoffs](docs/handoffs/README.md)

### Local verification

```sh
npm install
npm run check
npm run build
npm run dev
```

No deployment or direct push to main without lead approval. All provider fixtures must remain visibly labeled as mock.
