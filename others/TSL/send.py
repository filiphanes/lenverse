import socket
import sys

def calculate_checksum(packet):
    checksum = 0
    for byte in packet:
        checksum ^= byte
    return checksum

def send_tsl_tally(ip, port, address, text, preview_tally=0, program_tally=1, left_tally=0, right_tally=0):
    """
    Send TSL 3.1 tally data to the specified IP and port.
    
    Args:
    ip (str): IP address of the device
    port (int): UDP port (default for TSL is often 4123 or configurable)
    address (int): TSL address (0-127)
    text (str): Text label, up to 16 characters
    preview_tally (int): 0=off, 1=red, 2=green for preview (left tally)
    program_tally (int): 0=off, 1=red, 2=green for program (right tally)
    left_tally (int): Additional left tally (usually 0 in V3.1)
    right_tally (int): Additional right tally (usually 0 in V3.1)
    """
    if len(text) > 16:
        text = text[:16]
    text_bytes = text.ljust(16, ' ').encode('ascii')
    
    # Tally bytes: left (preview), right (program), tally3, tally4
    tally1 = preview_tally.to_bytes(1, 'big')
    tally2 = program_tally.to_bytes(1, 'big')
    tally3 = left_tally.to_bytes(1, 'big')  # Often not used
    tally4 = right_tally.to_bytes(1, 'big')  # Often not used
    
    header = b'\x02' + address.to_bytes(1, 'big') + b'\x83'  # STX + address + command (text + tallies)
    data = text_bytes + tally1 + tally2 + tally3 + tally4
    footer = b'\x03'  # ETX
    
    packet = header + data + footer
    checksum = calculate_checksum(packet)
    packet += checksum.to_bytes(1, 'big')
    
    # Send via UDP
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(packet, (ip, port))
    sock.close()
    print(f"Sent TSL packet to {ip}:{port} for address {address}")

if __name__ == "__main__":
    #if len(sys.argv) < 5:
    #    print("Usage: python tally_sender.py <ip> <port> <address> <text> [preview=0] [program=1]")
    #    sys.exit(1)
    
    ip = "192.168.88.113" #sys.argv[1]
    port = 4455 #int(sys.argv[2])
    address = 6 #int(sys.argv[3])
    text = "ahoj" #sys.argv[4]
    preview = int(sys.argv[5]) if len(sys.argv) > 5 else 0
    program = int(sys.argv[6]) if len(sys.argv) > 6 else 1
    
    send_tsl_tally(ip, port, address, text, preview, program)
