import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { t, setLanguage, useLanguage } from '@/lib/i18n';
export function LanguageSelect() {
 const language = useLanguage();
 return <Dropdown.Root><Dropdown.Trigger className="language-trigger" aria-label={t('Choose language')}><Globe size={17} strokeWidth={1.7} aria-hidden="true"/><span>{language.toUpperCase()}</span><ChevronDown size={12} aria-hidden="true"/></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="menu-content language-menu" align="end" sideOffset={10} collisionPadding={12}><Dropdown.Label className="menu-label">{t('Language')}</Dropdown.Label><Dropdown.RadioGroup value={language} onValueChange={value => setLanguage(value as 'id' | 'en')}>{([['id','Bahasa Indonesia'],['en','English']] as const).map(([value,label])=><Dropdown.RadioItem key={value} value={value} className="menu-item"><span lang={value}>{label}</span><Dropdown.ItemIndicator className="language-check"><Check size={15} aria-hidden="true"/></Dropdown.ItemIndicator></Dropdown.RadioItem>)}</Dropdown.RadioGroup></Dropdown.Content></Dropdown.Portal></Dropdown.Root>;
}