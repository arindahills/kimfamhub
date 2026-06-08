import { useTranslation } from 'react-i18next'

interface Props {
  navKey: string
  icon: string
}

export default function PlaceholderPage({ navKey, icon }: Props) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-20"
      style={{ color: 'var(--text-muted)' }}>
      <span className="text-5xl">{icon}</span>
      <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
        {t(`nav.${navKey}`)}
      </p>
      <p className="text-sm">Migration in progress...</p>
    </div>
  )
}
