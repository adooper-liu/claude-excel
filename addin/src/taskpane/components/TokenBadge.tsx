import React from 'react';
import { formatTokenBadge, usageTooltip, type TokenUsage } from '../../services/token-meter';

interface Props {
  usage: TokenUsage;
}

export default function TokenBadge({ usage }: Props): JSX.Element {
  return (
    <span className="token-badge" title={usageTooltip(usage)}>
      {usage.tokens === 0 ? '0 tok' : formatTokenBadge(usage)}
    </span>
  );
}
