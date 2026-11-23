// ===== 1) แก้ตรงนี้: วาง Contract Address ของ Bank จาก Remix (deploy ผ่าน MetaMask) =====
const contractAddress = "0x370B0b8ff69870393b9aD6fE595De5B3e58eac93";

// ===== 2) ABI ของ Bank.sol =====
const abi = [
    "function deposit() payable",
    "function withdraw(uint256 amount)",
    "function checkBlance() view returns (uint256)",
    "event Deposit(address indexed owner, uint256 amount)",
    "event Withdraw(address indexed owner, uint256 amount)"
];

let provider, signer, contract, userAddress;

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };
const short = (a) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "--";
const errMsg = (err) => err.reason || err.shortMessage || err.message;
const fmt = (wei) => Number(ethers.formatEther(wei)).toFixed(4);

// ---------- เชื่อมต่อ MetaMask ----------
async function connect() {
    if (!window.ethereum) {
        alert("กรุณาติดตั้ง MetaMask ก่อน (ใช้ Chrome หรือ Brave)");
        return;
    }
    try {
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        // เช็คว่ามี contract อยู่ที่ address นี้บน network ปัจจุบัน
        const code = await provider.getCode(contractAddress);
        if (code === "0x") {
            setStatus("ไม่พบ contract ที่ address นี้ (เช็ค address หรือเปลี่ยน network ใน MetaMask)");
            return;
        }
        contract = new ethers.Contract(contractAddress, abi, signer);

        $("account").textContent = userAddress;
        $("connStatus").textContent = "Connected";
        $("connStatus").classList.add("on");
        $("connectBtn").textContent = short(userAddress);
        $("contractShort").textContent = short(contractAddress);

        const net = await provider.getNetwork();
        $("network").textContent = net.name === "unknown" ? "Chain " + net.chainId : net.name;

        setStatus("");
        await refreshAll();
    } catch (err) {
        setStatus("เชื่อมต่อไม่สำเร็จ: " + errMsg(err));
    }
}

// ---------- โหลดข้อมูลทั้งหมด ----------
async function refreshAll() {
    if (!contract) return setStatus("กรุณา Connect Wallet ก่อน");
    try {
        const [walletBal, myBal, totalBal] = await Promise.all([
            provider.getBalance(userAddress),
            contract.checkBlance(),
            provider.getBalance(contractAddress)
        ]);
        $("walletBalance").textContent = fmt(walletBal);
        $("bankBalance").textContent = fmt(myBal);
        $("totalBank").textContent = fmt(totalBal);
    } catch (err) {
        setStatus("โหลดข้อมูลไม่สำเร็จ: " + errMsg(err));
    }
    await loadHistory();
}

// ---------- ประวัติรายการ (ดึงจาก Event บน blockchain) ----------
async function loadHistory() {
    const body = $("historyBody");
    try {
        const latest = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latest - 50000); // RPC บางเจ้าจำกัดช่วง block

        const [deps, wds] = await Promise.all([
            contract.queryFilter(contract.filters.Deposit(userAddress), fromBlock, latest),
            contract.queryFilter(contract.filters.Withdraw(userAddress), fromBlock, latest)
        ]);

        const rows = [
            ...deps.map((e) => ({ type: "Deposit", e })),
            ...wds.map((e) => ({ type: "Withdraw", e }))
        ].sort((a, b) => b.e.blockNumber - a.e.blockNumber || b.e.index - a.e.index);

        if (rows.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="empty">No transactions yet</td></tr>';
            return;
        }

        body.innerHTML = rows.map(({ type, e }) => `
      <tr>
        <td class="${type === "Deposit" ? "tag-dep" : "tag-wd"}">${type}</td>
        <td>${ethers.formatEther(e.args.amount)}</td>
        <td>${e.blockNumber}</td>
        <td><a href="https://sepolia.etherscan.io/tx/${e.transactionHash}" target="_blank">${short(e.transactionHash)}</a></td>
      </tr>`).join("");
    } catch (err) {
        body.innerHTML = '<tr><td colspan="4" class="empty">โหลดประวัติไม่ได้ (RPC อาจจำกัดการค้น event)</td></tr>';
    }
}

// ---------- ตัวช่วยส่ง transaction ----------
async function runTx(action, txFn) {
    if (!contract) { setStatus("กรุณา Connect Wallet ก่อน"); return false; }
    try {
        setStatus("กรุณายืนยันใน MetaMask...");
        const tx = await txFn();
        setStatus("กำลังรอ transaction ยืนยัน...");
        await tx.wait();
        setStatus(action + " สำเร็จ ✅");
        await refreshAll();
        return true;
    } catch (err) {
        setStatus(action + " ไม่สำเร็จ: " + errMsg(err));
        return false;
    }
}

// ---------- 1) Deposit ----------
async function deposit() {
    const amount = $("depositAmount").value;
    if (!amount || Number(amount) <= 0) return setStatus("กรุณาใส่จำนวน ETH ที่จะฝาก");
    const ok = await runTx("Deposit", () =>
        contract.deposit({ value: ethers.parseEther(amount) })
    );
    if (ok) $("depositAmount").value = "";
}

// ---------- 2) Withdraw ----------
async function withdraw() {
    if (!contract) return setStatus("กรุณา Connect Wallet ก่อน");
    const amount = $("withdrawAmount").value;
    if (!amount || Number(amount) <= 0) return setStatus("กรุณาใส่จำนวน ETH ที่จะถอน");
    const wei = ethers.parseEther(amount);

    // เช็คยอดก่อน จะได้ไม่เสียค่า gas ฟรีๆ
    const bal = await contract.checkBlance();
    if (wei > bal) return setStatus("ยอดเงินฝากไม่พอ (มี " + ethers.formatEther(bal) + " ETH)");

    const ok = await runTx("Withdraw", () => contract.withdraw(wei));
    if (ok) $("withdrawAmount").value = "";
}

// ---------- ปุ่มถอนทั้งหมด ----------
async function fillMax() {
    if (!contract) return setStatus("กรุณา Connect Wallet ก่อน");
    const bal = await contract.checkBlance();
    $("withdrawAmount").value = ethers.formatEther(bal);
}

// ---------- เมนูซ้าย ----------
document.querySelectorAll(".menu-item").forEach((link) => {
    link.addEventListener("click", () => {
        document.querySelectorAll(".menu-item").forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
    });
});

// ---------- ผูกปุ่ม ----------
$("connectBtn").onclick = connect;
$("refreshBtn").onclick = refreshAll;
$("depositBtn").onclick = deposit;
$("withdrawBtn").onclick = withdraw;
$("maxBtn").onclick = fillMax;

if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
}