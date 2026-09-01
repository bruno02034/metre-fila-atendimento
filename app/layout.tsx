import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Pulso — Fila de atendimento',
  description:
    'Painel interno para distribuir atendimentos da equipe de suporte com justiça e clareza.',
  openGraph: {
    title: 'Pulso — Fila de atendimento',
    description:
      'Distribuição justa, status da equipe e histórico em um painel operacional compartilhado.',
    type: 'website',
    locale: 'pt_BR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pulso — Fila de atendimento',
    description:
      'Distribuição justa, status da equipe e histórico em um painel operacional compartilhado.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
