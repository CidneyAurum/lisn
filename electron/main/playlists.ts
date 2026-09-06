import fs from 'node:fs'
import { Song } from './sources/spi'

export interface UserPlaylist {
  id: string
  name: string
  createdAt: number
  keyword?: string       // 若由搜索结果一键保存，记录来源关键词
  songs: Song[]
}

export class PlaylistStore {
  constructor(private file: string) {}

  private load(): UserPlaylist[] {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf-8')).playlists ?? [] } catch { return [] }
  }
  private save(list: UserPlaylist[]): void {
    fs.writeFileSync(this.file, JSON.stringify({ playlists: list }, null, 2))
  }

  list(): UserPlaylist[] { return this.load() }

  create(name: string, keyword?: string): UserPlaylist {
    const list = this.load()
    const pl: UserPlaylist = { id: 'pl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5), name: name.trim() || '未命名歌单', createdAt: Date.now(), keyword, songs: [] }
    list.unshift(pl)
    this.save(list)
    return pl
  }

  delete(id: string): void { this.save(this.load().filter(p => p.id !== id)) }

  rename(id: string, name: string): void {
    const list = this.load()
    const p = list.find(x => x.id === id)
    if (p) { p.name = name.trim() || p.name; this.save(list) }
  }

  addSong(id: string, song: Song): { ok: boolean; detail: string } {
    const list = this.load()
    const p = list.find(x => x.id === id)
    if (!p) return { ok: false, detail: '歌单不存在' }
    if (p.songs.some(s => s.key === song.key)) return { ok: false, detail: '歌曲已在歌单中' }
    p.songs.unshift(song)
    this.save(list)
    return { ok: true, detail: '已加入「' + p.name + '」' }
  }

  removeSong(id: string, songKey: string): void {
    const list = this.load()
    const p = list.find(x => x.id === id)
    if (p) { p.songs = p.songs.filter(s => s.key !== songKey); this.save(list) }
  }

  /** 搜索结果一键存为歌单 */
  saveFromSearch(name: string, keyword: string, songs: Song[]): UserPlaylist {
    const pl = this.create(name, keyword)
    pl.songs = songs.slice(0, 50)
    const list = this.load()
    const idx = list.findIndex(p => p.id === pl.id)
    if (idx >= 0) list[idx] = pl
    this.save(list)
    return pl
  }
}
