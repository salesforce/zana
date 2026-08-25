import { Bot } from 'lucide-react';
import { providerIconForId } from './provider-icon.js';

export function ProviderIcon({
  providerId,
  size = 13,
  className
}: {
  providerId: string;
  size?: number;
  className?: string;
}) {
  const Icon = providerIconForId(providerId);
  if (Icon) return <Icon size={size} className={className} />;
  return <Bot size={size} className={className} aria-hidden="true" />;
}
