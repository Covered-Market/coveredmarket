import type * as React from 'react';

export type Status = 'open' | 'kept' | 'exercised' | 'settled' | 'pending' | 'refused';

export interface MarkProps { size?: number; tone?: 'ink' | 'two-tone' | 'copper'; state?: 'open' | 'kept' | 'exercised'; className?: string; style?: React.CSSProperties }
/** The Lid: one coin, its top lifted off. `ink` uses currentColor; `two-tone` is the intaglio coin with a gilt lid; `copper` the copper coin with an intaglio lid. `state` sets how far the lid is lifted. */
export declare function Mark(props: MarkProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'quiet' | 'danger'; size?: 'sm' | 'md' | 'lg'; href?: string }
export declare function Button(props: ButtonProps): React.ReactElement;

export interface StampProps { status: Status; flat?: boolean; children?: React.ReactNode; className?: string }
/** A rubber stamp carrying the status word. Rotated by default; `flat` inside tables. */
export declare function Stamp(props: StampProps): React.ReactElement;

export interface FigureProps { value: number | string; kind?: 'btc' | 'usd' | 'pct' | 'plain'; unit?: string | null; size?: 'xl' | 'md' | 'sm'; tone?: 'ink' | 'btc' | 'gilt' | 'muted'; className?: string }
/** Every number: mono, tabular. `kind` formats; BTC is copper-ink, premiums gilt-ink. */
export declare function Figure(props: FigureProps): React.ReactElement;

export interface CoinProps { amount: number; size?: 'md' | 'lg'; className?: string }
export declare function Coin(props: CoinProps): React.ReactElement;

export interface FieldProps { label: string; value?: string; defaultValue?: string; placeholder?: string; adorn?: string; help?: string; invalid?: boolean; id?: string; inputMode?: string; onChange?: React.ChangeEventHandler<HTMLInputElement>; className?: string }
export declare function Field(props: FieldProps): React.ReactElement;

export interface StatTileProps { label: string; value: number | string; kind?: FigureProps['kind']; unit?: string | null; tone?: FigureProps['tone']; note?: string; className?: string }
export declare function StatTile(props: StatTileProps): React.ReactElement;

export interface Offer { strike: number; expiry: string; premium: number; annualised: number; size: number; spot: number; vault: string; seller: string; status?: Status }
/** `actionDisabled` shows the action as it will look but inert, for previews. */
export interface OfferCardProps { offer: Offer; action?: string; onAct?: () => void; actionDisabled?: boolean; className?: string }
export declare function OfferCard(props: OfferCardProps): React.ReactElement;

export interface PositionRow { id: string; side: 'sell' | 'buy'; size: number; strike: number; expiry: string; premium: number; status: Status }
export interface PositionsTableProps { rows: PositionRow[]; className?: string }
export declare function PositionsTable(props: PositionsTableProps): React.ReactElement;

export interface CountdownProps { totalSeconds: number; secondsLeft: number; label?: string; note?: string; className?: string }
export declare function Countdown(props: CountdownProps): React.ReactElement;

export interface TimelineStep { title: string; detail?: string; when?: string; state?: 'done' | 'now' | 'todo' | 'refused' }
export interface SettlementTimelineProps { steps: TimelineStep[]; className?: string }
export declare function SettlementTimeline(props: SettlementTimelineProps): React.ReactElement;

export interface NoticeProps { tone?: 'note' | 'refused'; children?: React.ReactNode; className?: string }
export declare function Notice(props: NoticeProps): React.ReactElement;

export interface TopBarProps { items?: { label: string; href?: string; on?: boolean }[]; href?: string; children?: React.ReactNode; className?: string }
export declare function TopBar(props: TopBarProps): React.ReactElement;

export interface Contract { serial: string; issued: string; size: number; strike: number; expiry: string; premium: number; vault: string; seller: string; buyer?: string; contractId?: string; status?: Status }
export interface CertificateProps { contract: Contract; children?: React.ReactNode; className?: string }
/** The option as a security: the hero object of the brand. Children are the action buttons in the footer. */
export declare function Certificate(props: CertificateProps): React.ReactElement;

declare global { interface Window { CoveredMarket: { Mark: typeof Mark; Button: typeof Button; Stamp: typeof Stamp; Figure: typeof Figure; Coin: typeof Coin; Field: typeof Field; StatTile: typeof StatTile; OfferCard: typeof OfferCard; PositionsTable: typeof PositionsTable; Countdown: typeof Countdown; SettlementTimeline: typeof SettlementTimeline; Notice: typeof Notice; TopBar: typeof TopBar; Certificate: typeof Certificate } } }
