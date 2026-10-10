"""Public article metadata, rendered into the existing application shell."""
from html import escape, unescape
from email.utils import formatdate
import re
from xml.etree import ElementTree as ET


def plain_summary(text):
    text=re.sub(r'```.*?```|~~~.*?~~~',' ',text,flags=re.S)
    text=re.sub(r'!\[[^\]]*\]\([^)]*\)',' ',text)
    text=re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',text)
    text=re.sub(r'<[^>]*>',' ',text)
    text=re.sub(r'(?m)^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)','',text)
    return re.sub(r'\s+',' ',unescape(text).replace('`','').replace('**','').replace('__','')).strip()[:180]


def render_rss(records,profile,origin):
    origin=origin.rstrip('/')
    rss=ET.Element('rss',version='2.0')
    channel=ET.SubElement(rss,'channel')

    def element(parent,name,value,**attrs):
        # Text fields may contain characters XML 1.0 cannot represent.
        ET.SubElement(parent,name,attrs).text=re.sub(r'[^\x09\x0a\x0d\x20-\ud7ff\ue000-\ufffd\U00010000-\U0010ffff]','',str(value))

    element(channel,'title',profile['name'])
    element(channel,'link',origin+'/')
    element(channel,'description',plain_summary(profile['bio']) or profile['name'])
    for record in records:
        item=ET.SubElement(channel,'item')
        element(item,'title',record['title'])
        element(item,'link',f"{origin}/read/{record['kind']}/{record['id']}")
        element(item,'guid',f"urn:personal-website:{record['kind']}:{record['id']}",isPermaLink='false')
        if record['published_at'] is not None:
            element(item,'pubDate',formatdate(record['published_at'],usegmt=True))
        element(item,'description',plain_summary(record.get('summary') or record.get('body') or record['title']))
    return ET.tostring(rss,encoding='utf-8',xml_declaration=True)


def render_public_page(shell,record,profile,origin,path):
    origin=origin.rstrip('/')
    title=record['title']
    description=plain_summary(record.get('summary') or record.get('body') or record.get('notes') or title)
    canonical=origin+path
    metadata=[f'<title>{escape(title)} · {escape(profile["name"])}</title>',
              f'<link rel="canonical" href="{escape(canonical,quote=True)}">']
    values={'description':description,'og:title':title,'og:description':description,'og:url':canonical,'og:type':'article'}
    cover=record.get('cover_url') or profile.get('avatar_url')
    if cover: values['og:image']=origin+cover
    for name,value in values.items():
        attribute='property' if name.startswith('og:') else 'name'
        metadata.append(f'<meta {attribute}="{name}" content="{escape(value,quote=True)}">')
    return re.sub(r'<title>.*?</title>',lambda match:'\n  '.join(metadata),shell,count=1,flags=re.S)
