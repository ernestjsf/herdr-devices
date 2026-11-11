// Turns a simulator's JPEG frames into small PNGs a terminal can draw fast.
// stdin:  [u32 length][u32 longest side wanted, px][u32 colour bits kept, 1-8][JPEG bytes], big-endian.
// stdout: [u32 width][u32 height][u32 length][PNG bytes] per frame; 0 0 0 for a frame it couldn't read.
// Built once with `swiftc -O` (see screen-term.mjs).
//
// A Herdr terminal takes a frame in time that grows with its bytes, not its pixels (about 1 ms per
// 30 KB), so the work here is making frames small: each row is stored as its difference from the
// row above (PNG's Up filter), and a moving frame keeps only its top colour bits, which is not
// seen in motion and deflates to less than half. ImageIO decodes at the size asked for.
import Foundation
import ImageIO
import CoreGraphics
import zlib

let input = FileHandle.standardInput, output = FileHandle.standardOutput

func readExactly(_ n: Int) -> Data? {
  var data = Data()
  while data.count < n {
    let chunk = input.readData(ofLength: n - data.count)
    if chunk.isEmpty { return nil }
    data.append(chunk)
  }
  return data
}

func u32(_ d: Data) -> Int { d.reduce(0) { ($0 << 8) | Int($1) } }
func be(_ v: Int) -> Data { Data([UInt8((v >> 24) & 255), UInt8((v >> 16) & 255), UInt8((v >> 8) & 255), UInt8(v & 255)]) }

func chunk(_ type: String, _ data: Data) -> Data {
  var body = Data(type.utf8)
  body.append(data)
  let crc = body.withUnsafeBytes { crc32(0, $0.bindMemory(to: UInt8.self).baseAddress, UInt32(body.count)) }
  return be(data.count) + body + be(Int(crc))
}

// RGBA pixels as a PNG: RGB, colours cut to `bits` (the top bits repeated below, so white stays
// white), rows filtered Up, deflated at level 1.
func png(_ rgba: UnsafePointer<UInt8>, _ w: Int, _ h: Int, _ bits: Int) -> Data? {
  let stride = w * 3, line = stride + 1, mask = UInt8(truncatingIfNeeded: 0xff << (8 - bits))
  let cut = UnsafeMutablePointer<UInt8>.allocate(capacity: 256), rows = UnsafeMutablePointer<UInt8>.allocate(capacity: line * h)
  defer { cut.deallocate(); rows.deallocate() }
  for v in 0..<256 { let top = UInt8(v) & mask; cut[v] = bits >= 8 ? UInt8(v) : top | (top >> UInt8(bits)) }
  // First the cut colours, row after row, each behind its filter byte; then, from the last row
  // up, each row minus the one above it.
  for y in 0..<h {
    var source = rgba + y * w * 4, out = rows + y * line
    out.pointee = y == 0 ? 0 : 2
    out += 1
    for _ in 0..<w { out[0] = cut[Int(source[0])]; out[1] = cut[Int(source[1])]; out[2] = cut[Int(source[2])]; out += 3; source += 4 }
  }
  var y = h - 1
  while y > 0 {
    let row = rows + y * line + 1, above = row - line
    for x in 0..<stride { row[x] = row[x] &- above[x] }
    y -= 1
  }
  var size = compressBound(UInt(line * h))
  let packed = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(size))
  defer { packed.deallocate() }
  guard compress2(packed, &size, rows, UInt(line * h), 1) == Z_OK else { return nil }
  var header = be(w) + be(h)
  header.append(contentsOf: [8, 2, 0, 0, 0]) // 8 bits a channel, RGB
  return Data([137, 80, 78, 71, 13, 10, 26, 10]) + chunk("IHDR", header) + chunk("IDAT", Data(bytes: packed, count: Int(size))) + chunk("IEND", Data())
}

func picture(_ jpeg: Data, _ side: Int, _ bits: Int) -> (Int, Int, Data)? {
  let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: side, kCGImageSourceShouldCacheImmediately: true]
  guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
        let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
  let w = image.width, h = image.height
  var rgba = [UInt8](repeating: 0, count: w * h * 4)
  let data: Data? = rgba.withUnsafeMutableBytes { buffer in
    guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return png(buffer.bindMemory(to: UInt8.self).baseAddress!, w, h, bits)
  }
  return data.map { (w, h, $0) }
}

while let head = readExactly(12) {
  let length = u32(head.prefix(4)), side = u32(head.subdata(in: 4..<8)), bits = min(8, max(1, u32(head.suffix(4))))
  guard let jpeg = readExactly(length) else { break }
  if let (w, h, data) = picture(jpeg, side, bits) { output.write(be(w) + be(h) + be(data.count) + data) } else { output.write(be(0) + be(0) + be(0)) }
}
